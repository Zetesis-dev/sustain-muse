import { APICallError, generateText, jsonSchema, tool, type ModelMessage } from 'ai'
import { redact } from './redact.ts'
import { costOf, type AgentTask, type ModelRef } from './router.config.ts'
import { liveModel, providerOptions, reason, type CompleteOptions } from './call.ts'

// the conversation's messages, so packages/agent needn't import the SDK
export type { ModelMessage }

// One step of an agent run (BUILD_PLAN.md P7): the model reads the
// conversation so far and asks for tools, or answers. The tools are only
// described here. packages/agent decides whether each call may run, runs it
// in the sandbox, and sends back what it found, so nothing a model asks for
// runs on its say-so.

export type ToolSpec = {
  name: string
  description: string
  // a JSON schema for the tool's input, an object
  parameters: Record<string, unknown>
}

export type StepCall = { id: string; name: string; input: unknown }

export type AgentStep = {
  text: string
  calls: StepCall[]
  // the model's turn, to append to the conversation
  messages: ModelMessage[]
  inputTokens: number | null
  outputTokens: number | null
  // of inputTokens, how many the provider read from its own cache: what an
  // earlier turn already sent. None when left out
  cachedTokens?: number
  costUsd: number | null
  // why the call, which answered, couldn't be logged
  unlogged?: string
}

type StepInput = {
  system: string
  messages: ModelMessage[]
  tools: ToolSpec[]
  maxOutputTokens: number
  timeoutMs?: number
}

// Every text in the conversation redacted, as a prompt is: what a tool read
// from a repository can hold a secret, and the model can repeat one in a
// tool call's arguments. Ids and tool names are left as they are.
export function redactMessages(messages: ModelMessage[], secrets?: string[]): ModelMessage[] {
  const clean = (v: string) => redact(v, secrets)
  const deep = (v: unknown): unknown =>
    typeof v === 'string'
      ? clean(v)
      : Array.isArray(v)
        ? v.map(deep)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]))
          : v
  return messages.map((m) => {
    if (typeof m.content === 'string') return { ...m, content: clean(m.content) } as ModelMessage
    return {
      ...m,
      content: m.content.map((part) => {
        if (part.type === 'text' || part.type === 'reasoning')
          return { ...part, text: clean(part.text) }
        if (part.type === 'tool-call') return { ...part, input: deep(part.input) }
        if (part.type === 'tool-result')
          return {
            ...part,
            output:
              'value' in part.output
                ? { ...part.output, value: deep(part.output.value) }
                : deep(part.output),
          }
        return part
      }),
    } as ModelMessage
  })
}

// How long to wait before sending a request again that the provider turned
// away unread (429 too many requests, 529 overloaded), or null when it
// shouldn't be: anything else, a quota that's used up, or the fifth try.
// A retry-after of up to a minute is honored; otherwise 2, 4, 8, 16 seconds.
const TURNED_AWAY = [429, 529]
const RETRIES_TURNED_AWAY = 4
function turnedAway(err: unknown, attempt: number): number | null {
  if (!APICallError.isInstance(err) || !TURNED_AWAY.includes(err.statusCode ?? 0)) return null
  if (attempt > RETRIES_TURNED_AWAY) return null
  if (/insufficient_quota|credit balance/i.test(err.responseBody ?? '')) return null
  const headers = err.responseHeaders ?? {}
  const ms = Number(headers['retry-after-ms'] ?? NaN)
  const seconds = Number(headers['retry-after'] ?? NaN)
  const asked = Number.isFinite(ms) ? ms : Number.isFinite(seconds) ? seconds * 1000 : NaN
  return Number.isFinite(asked) && asked >= 0 && asked <= 60_000
    ? asked
    : 2_000 * 2 ** (attempt - 1)
}

// One model, one step. Null when the model couldn't answer, logged like any
// other call. A call that answered but couldn't be logged still comes back
// with what it cost, marked unlogged: the spend happened either way.
export async function agentStep(
  task: AgentTask,
  ref: ModelRef,
  input: StepInput,
  opts: CompleteOptions,
): Promise<AgentStep | null> {
  const env = opts.env ?? process.env
  const started = Date.now()
  const wait = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const deadline = started + (input.timeoutMs ?? 120_000)
  let answer: Omit<AgentStep, 'costUsd' | 'unlogged'>
  try {
    const model = opts.model ? opts.model(ref) : liveModel(ref, env)
    const system = redact(input.system, opts.secrets)
    const messages = redactMessages(input.messages, opts.secrets)
    const options = providerOptions(ref)
    const attempt = async () => {
      const result = await generateText({
        model,
        system,
        messages,
        tools: Object.fromEntries(
          input.tools.map((t) => [
            t.name,
            tool({ description: t.description, inputSchema: jsonSchema(t.parameters) }),
          ]),
        ),
        maxOutputTokens: input.maxOutputTokens,
        // The SDK's own retries are off: a call that failed may still have
        // been charged, so the agent's loop decides on another, by its
        // budget. Only a request turned away unread, too many at once or
        // the provider overloaded, is sent again below, after the wait it
        // asks for, while the time allows: that one costs nothing.
        maxRetries: 0,
        timeout: Math.max(1, Math.min(deadline - Date.now(), 120_000)),
        ...(options ? { providerOptions: options } : {}),
      })
      return {
        text: result.text,
        calls: result.toolCalls.map((c) => ({
          id: c.toolCallId,
          name: c.toolName,
          input: c.input,
        })),
        messages: result.response.messages,
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        cachedTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
      }
    }
    for (let tries = 1; ; tries++) {
      try {
        answer = await attempt()
        break
      } catch (err) {
        const pause = turnedAway(err, tries)
        if (pause === null || Date.now() + pause + 5_000 > deadline) throw err
        await wait(pause)
      }
    }
  } catch (err) {
    await opts
      .log({
        task,
        provider: ref.provider,
        model: ref.model,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        latencyMs: Date.now() - started,
        ok: false,
        error: reason(err, opts.secrets),
      })
      .catch(() => {})
    return null
  }
  const { inputTokens, outputTokens, cachedTokens } = answer
  const costUsd = costOf(ref.model, inputTokens ?? 0, outputTokens ?? 0, cachedTokens)
  const step: AgentStep = { ...answer, costUsd }
  try {
    await opts.log({
      task,
      provider: ref.provider,
      model: ref.model,
      inputTokens,
      outputTokens,
      costUsd,
      latencyMs: Date.now() - started,
      ok: true,
      error: null,
    })
  } catch (err) {
    return { ...step, unlogged: reason(err, opts.secrets) }
  }
  return step
}

// what a tool sent back, as the next message in the conversation
export function toolResults(results: { id: string; name: string; output: string }[]): ModelMessage {
  return {
    role: 'tool',
    content: results.map((r) => ({
      type: 'tool-result' as const,
      toolCallId: r.id,
      toolName: r.name,
      output: { type: 'text' as const, value: r.output },
    })),
  }
}
