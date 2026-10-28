import { createOpenAI } from '@ai-sdk/openai'
import { embedMany, generateText, type EmbeddingModel } from 'ai'
import { liveModel, providerOptions, reason, type CompleteOptions } from './call.ts'
import { redact } from './redact.ts'
import { costOf, EMBEDDINGS, ROUTER, type ModelRef, type TaskClass } from './router.config.ts'

// The one way Sustain calls a model (D08, AGENTS.md: only from jobs, only
// through here). Every call is redacted on the way out and logged, and a
// failure falls back to the task's second model, then to nothing: callers
// always have a written alternative.

export { redact } from './redact.ts'
export { type CompleteOptions, type LlmCall } from './call.ts'
export {
  AGENT_ROUTER,
  agentRoute,
  cachedOf,
  CLASS_ROUTES,
  costOf,
  EMBEDDINGS,
  PRICES,
  ROUTER,
  type AgentTask,
  type ClassRoute,
  type LoggedTask,
  type ModelRef,
  type Provider,
  type Route,
  type TaskClass,
} from './router.config.ts'
export * from './summarize.ts'
export * from './profile.ts'
export * from './lesson.ts'
export * from './judge.ts'
export * from './draft.ts'
export * from './agent.ts'

// timeoutMs: 30 seconds unless the task needs longer (a profile reads a
// whole app's facts)
type Input = { system: string; prompt: string; maxOutputTokens: number; timeoutMs?: number }

// One model, once: what the router's two steps and the evals both use.
export async function completeWith(
  task: TaskClass,
  ref: ModelRef,
  input: Input,
  opts: CompleteOptions,
): Promise<{ text: string; model: string } | null> {
  const env = opts.env ?? process.env
  const started = Date.now()
  try {
    const model = opts.model ? opts.model(ref) : liveModel(ref, env)
    const options = providerOptions(ref)
    const result = await generateText({
      model,
      system: redact(input.system, opts.secrets),
      prompt: redact(input.prompt, opts.secrets),
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 1,
      timeout: input.timeoutMs ?? 30_000,
      // a summary needs no long thinking
      ...(options ? { providerOptions: options } : {}),
    })
    const inputTokens = result.usage.inputTokens ?? null
    const outputTokens = result.usage.outputTokens ?? null
    const cached = result.usage.inputTokenDetails?.cacheReadTokens ?? 0
    await opts.log({
      task,
      provider: ref.provider,
      model: ref.model,
      inputTokens,
      outputTokens,
      costUsd: costOf(ref.model, inputTokens ?? 0, outputTokens ?? 0, cached),
      latencyMs: Date.now() - started,
      ok: true,
      error: null,
    })
    return { text: result.text, model: ref.model }
  } catch (err) {
    await opts.log({
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
    return null
  }
}

// The task's primary model, then its fallback if it has one, then nothing.
export async function complete(
  task: TaskClass,
  input: Input,
  opts: CompleteOptions,
): Promise<{ text: string; model: string } | null> {
  const route = opts.route ?? ROUTER[task]
  return (
    (await completeWith(task, route.primary, input, opts)) ??
    (route.fallback ? await completeWith(task, route.fallback, input, opts) : null)
  )
}

export type EmbedOptions = Pick<CompleteOptions, 'log' | 'secrets' | 'env'> & {
  // tests hand in their own model
  model?: EmbeddingModel
}

const EMBED_BATCH = 96

// Embeddings for pieces of code, in order, from the model EMBEDDINGS names.
// Each piece is redacted first, like a prompt. Null when any batch fails, so
// the caller keeps what it had and tries again next build.
export async function embed(values: string[], opts: EmbedOptions): Promise<number[][] | null> {
  const env = opts.env ?? process.env
  const out: number[][] = []
  for (let i = 0; i < values.length; i += EMBED_BATCH) {
    const batch = values.slice(i, i + EMBED_BATCH).map((v) => redact(v, opts.secrets))
    const started = Date.now()
    try {
      let model = opts.model
      if (!model) {
        const apiKey = env.OPENAI_API_KEY
        if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
        model = createOpenAI({ apiKey }).textEmbeddingModel(EMBEDDINGS.model)
      }
      const result = await embedMany({ model, values: batch, maxRetries: 1 })
      const tokens = result.usage.tokens ?? null
      await opts.log({
        task: 'embed_code',
        provider: EMBEDDINGS.provider,
        model: EMBEDDINGS.model,
        inputTokens: tokens,
        outputTokens: 0,
        costUsd: costOf(EMBEDDINGS.model, tokens ?? 0, 0),
        latencyMs: Date.now() - started,
        ok: true,
        error: null,
      })
      for (const e of result.embeddings) {
        if (e.length !== EMBEDDINGS.dimensions) return null
        out.push(e)
      }
    } catch (err) {
      await opts.log({
        task: 'embed_code',
        provider: EMBEDDINGS.provider,
        model: EMBEDDINGS.model,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        latencyMs: Date.now() - started,
        ok: false,
        error: reason(err, opts.secrets),
      })
      return null
    }
  }
  return out
}
