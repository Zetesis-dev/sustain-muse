import { describe, expect, it } from 'vitest'
import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { liveModel, providerOptions } from './call.ts'
import {
  AGENT_ROUTER,
  agentRoute,
  agentStep,
  cleanSummary,
  complete,
  completeWith,
  costOf,
  redact,
  summaryPrompt,
  toolResults,
  type LlmCall,
} from './index.ts'

const reply = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: {
    inputTokens: { total: 400, noCache: 400, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 40, text: 40, reasoning: 0 },
  },
  warnings: [],
})

describe('redaction', () => {
  it('strips stored secrets and every known key format', () => {
    const text = [
      'key AKIAABCDEFGHIJKLMNOP and ghp_0123456789abcdefghijklmnopqrstuvwxyz',
      'stripe sk_live_0123456789abcdefghij and a stored one: hunter2-hunter2',
      '-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----',
      'jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4fw',
      'pubspec.yaml lists http ^0.13.6',
    ].join('\n')
    const out = redact(text, ['hunter2-hunter2'])
    expect(out).not.toMatch(/AKIA|ghp_|sk_live|hunter2|BEGIN PRIVATE|eyJhbG/)
    expect(out).toContain('pubspec.yaml lists http ^0.13.6')
  })
})

// built from their codes: the brand's lint keeps them out of literals
const RSQUO = String.fromCharCode(0x2019)
const EMDASH = String.fromCharCode(0x2014)

describe('summaries', () => {
  it('keeps two clean lines', () => {
    expect(
      cleanSummary(
        'go_router and 9 other packages are a major version behind.\nThe longer they wait, the bigger the upgrade gets.',
      ),
    ).toBe(
      'go_router and 9 other packages are a major version behind.\nThe longer they wait, the bigger the upgrade gets.',
    )
    // curly quotes become straight
    expect(
      cleanSummary(
        `The app${RSQUO}s token ends on 13 November.\nAfter that, the checks that use it stop.`,
      ),
    ).toContain("app's")
  })

  it('throws away anything that breaks the voice rules', () => {
    const bad = [
      'One line only.',
      'Line one.\nLine two.\nLine three.',
      `Rules are open ${EMDASH} anyone can write.\nData can change.`,
      '**Open rules.**\nData can change.',
      '- Open rules\n- Data can change',
      'Your data is not safe.\nAnyone can read it.',
      'Huge problem!\nFix it now.',
      '1. Open rules\n2. Data can change',
      'Problem: the token ends soon.\nChecks stop after it ends.',
      'The token ends 2026-11-13.\nChecks stop after it ends.',
    ]
    for (const b of bad) expect(cleanSummary(b), b).toBeNull()
  })

  it('puts the facts in the prompt, a few at most', () => {
    const p = summaryPrompt({
      title: 'flutter test fails on main',
      severity: 'high',
      why: 'The main branch is what the next release is built from.',
      evidence: Array.from({ length: 30 }, (_, i) => `fact ${i}`),
    })
    expect(p).toContain('Problem: flutter test fails on main')
    expect(p.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(15)
  })
})

describe('calling a model', () => {
  const input = { system: 'S', prompt: 'P with AKIAABCDEFGHIJKLMNOP', maxOutputTokens: 100 }

  it('uses the primary model, logs the call and what it cost', async () => {
    const calls: LlmCall[] = []
    const seen: string[] = []
    const out = await complete('summarize_finding', input, {
      log: async (c) => void calls.push(c),
      model: () =>
        new MockLanguageModelV4({
          doGenerate: async (options) => {
            seen.push(JSON.stringify(options.prompt))
            return reply('Line one.\nLine two.')
          },
        }),
    })
    expect(out).toEqual({ text: 'Line one.\nLine two.', model: 'claude-haiku-4-5-20251001' })
    expect(seen[0]).not.toContain('AKIA')
    expect(calls).toMatchObject([
      { model: 'claude-haiku-4-5-20251001', ok: true, inputTokens: 400, outputTokens: 40 },
    ])
    expect(calls[0]!.costUsd).toBeCloseTo(costOf('claude-haiku-4-5-20251001', 400, 40)!)
  })

  it("leaves the rule's words when the only model that passed can't answer", async () => {
    const calls: LlmCall[] = []
    const out = await complete('summarize_finding', input, {
      log: async (c) => void calls.push(c),
      model: () =>
        new MockLanguageModelV4({
          doGenerate: async () => {
            throw new Error('overloaded')
          },
        }),
    })
    expect(out).toBeNull()
    expect(calls.map((c) => [c.model, c.ok])).toEqual([['claude-haiku-4-5-20251001', false]])
  })

  it('falls back to a second model when a route has one, then to nothing', async () => {
    const calls: LlmCall[] = []
    let n = 0
    const route = {
      primary: { provider: 'anthropic' as const, model: 'claude-haiku-4-5-20251001' },
      fallback: { provider: 'openai' as const, model: 'gpt-5-nano', reasoning: 'minimal' as const },
      chosenBy: 'a test',
    }
    const out = await complete('summarize_finding', input, {
      route,
      log: async (c) => void calls.push(c),
      model: () =>
        new MockLanguageModelV4({
          doGenerate: async () => {
            n++
            if (n === 1) throw new Error('overloaded')
            return reply('From the fallback.\nSecond line.')
          },
        }),
    })
    expect(out?.model).toBe('gpt-5-nano')
    expect(calls.map((c) => c.ok)).toEqual([false, true])

    const none = await complete('summarize_finding', input, {
      route,
      log: async () => {},
      model: () =>
        new MockLanguageModelV4({
          doGenerate: async () => {
            throw new Error('down')
          },
        }),
    })
    expect(none).toBeNull()
  })

  it('fails over cleanly when a key is missing', async () => {
    const calls: LlmCall[] = []
    expect(
      await complete('summarize_finding', input, { log: async (c) => void calls.push(c), env: {} }),
    ).toBeNull()
    expect(calls.map((c) => c.error)).toEqual(['ANTHROPIC_API_KEY is not set'])
  })

  it("speaks to Meta's Model API as Chat Completions, telling Muse how hard to think", async () => {
    const muse = { provider: 'meta' as const, model: 'muse-spark-1.3', reasoning: 'low' as const }
    const calls: LlmCall[] = []
    expect(
      await completeWith('summarize_finding', muse, input, {
        log: async (c) => void calls.push(c),
        env: {},
      }),
    ).toBeNull()
    expect(calls.map((c) => [c.provider, c.error])).toEqual([
      ['meta', 'META_AI_API_KEY is not set'],
    ])
    const model = liveModel(muse, { META_AI_API_KEY: 'test-key' })
    expect(typeof model === 'object' && [model.provider, model.modelId]).toEqual([
      'openai.chat',
      'muse-spark-1.3',
    ])
    // the SDK doesn't know Muse reasons, so it's told, its system prompt kept
    expect(providerOptions(muse)).toEqual({
      openai: { reasoningEffort: 'low', forceReasoning: true, systemMessageMode: 'system' },
    })
    expect(
      providerOptions({ provider: 'openai', model: 'gpt-5.4-mini', reasoning: 'low' }),
    ).toEqual({ openai: { reasoningEffort: 'low' } })
    expect(providerOptions({ provider: 'meta', model: 'muse-wonder-1.0' })).toBeUndefined()
    expect(costOf('muse-spark-1.3', 1_000_000, 1_000_000)).toBe(5.5)
  })

  it("routes a class's small tasks in one ecosystem apart from its work's, and nothing else", () => {
    const spark = 'muse-spark-1.3'
    const sonnet = AGENT_ROUTER.upgrade.primary.model
    const model = (cls: string, eco: 'node' | 'dart', files: number) =>
      agentRoute('upgrade', cls, eco, files).primary.model
    // Node SDK migrations naming 1 to 3 files go to Muse, with Sonnet behind
    expect([1, 2, 3].map((n) => model('sdk_migration', 'node', n))).toEqual([spark, spark, spark])
    expect(agentRoute('upgrade', 'sdk_migration', 'node', 2).fallback?.model).toBe(sonnet)
    // a larger task, one that names no file, Dart's, or another class keep the work's
    expect(model('sdk_migration', 'node', 4)).toBe(sonnet)
    expect(model('sdk_migration', 'node', 0)).toBe(sonnet)
    expect(model('sdk_migration', 'dart', 1)).toBe(sonnet)
    expect(model('dependency_bump', 'node', 1)).toBe(sonnet)
    expect(agentRoute('fix', 'deprecated_api', 'node', 1)).toBe(AGENT_ROUTER.fix)
  })

  it('prices what the provider read from its cache at its cached rate, where it has one', async () => {
    // Muse: 1,000,000 in, 800,000 of them cached, at 0.15 a million
    expect(costOf('muse-spark-1.3', 1_000_000, 0, 800_000)).toBeCloseTo(0.25 + 0.12, 10)
    // a model with no cached rate is priced in full, and so is usage whose
    // cached count can't be true: past the input, negative, or not whole
    expect(costOf('claude-sonnet-5-5', 1_000_000, 0, 800_000)).toBe(2)
    for (const wrong of [5_000, -1, 0.5, Number.NaN])
      expect(costOf('muse-spark-1.3', 1_000, 0, wrong), String(wrong)).toBeCloseTo(
        1_000 * 1.25e-6,
        12,
      )
    // an agent step's cost reads the cached tokens the call reports
    const calls: LlmCall[] = []
    const step = await agentStep(
      'fix',
      { provider: 'meta', model: 'muse-spark-1.3' },
      { system: 'S', messages: [{ role: 'user', content: 'go' }], tools: [], maxOutputTokens: 100 },
      {
        log: async (c) => void calls.push(c),
        model: () =>
          new MockLanguageModelV4({
            doGenerate: async () => ({
              ...reply('done'),
              usage: {
                inputTokens: { total: 400, noCache: 100, cacheRead: 300, cacheWrite: 0 },
                outputTokens: { total: 40, text: 40, reasoning: 0 },
              },
            }),
          }),
      },
    )
    const cost = (100 * 1.25 + 300 * 0.15 + 40 * 4.25) / 1_000_000
    expect(step?.costUsd).toBeCloseTo(cost, 12)
    expect(calls[0]?.costUsd).toBeCloseTo(cost, 12)
  })
})

describe('an agent step', () => {
  it('hands back the tools the model asks for, and logs the call, redacted', async () => {
    const calls: LlmCall[] = []
    let sent = ''
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        sent = JSON.stringify(options.prompt)
        return {
          content: [
            { type: 'text' as const, text: 'Reading the file first.' },
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName: 'read_file',
              input: JSON.stringify({ path: 'lib/main.dart' }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
          usage: {
            inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 50, text: 50, reasoning: 0 },
          },
          warnings: [],
        }
      },
    })
    const step = await agentStep(
      'fix',
      { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      {
        system: 'Fix the deprecated call.',
        messages: [
          { role: 'user', content: 'The task.' },
          // the model repeating a secret in a tool call's arguments
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call-0',
                toolName: 'read_file',
                input: { path: 'lib/hunter2-hunter2.dart' },
              },
            ],
          },
          toolResults([{ id: 'call-0', name: 'read_file', output: 'key: hunter2-hunter2' }]),
        ],
        tools: [
          {
            name: 'read_file',
            description: 'Read a file.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
        maxOutputTokens: 2000,
      },
      { log: async (c) => void calls.push(c), model: () => model, secrets: ['hunter2-hunter2'] },
    )
    expect(step?.calls).toEqual([
      { id: 'call-1', name: 'read_file', input: { path: 'lib/main.dart' } },
    ])
    expect(step?.text).toBe('Reading the file first.')
    expect(step?.messages.at(-1)?.role).toBe('assistant')
    expect(calls).toMatchObject([{ task: 'fix', ok: true, inputTokens: 1000, outputTokens: 50 }])
    // a secret a tool read, or the model repeated, never leaves
    expect(sent).not.toContain('hunter2')
    expect(sent).toContain('lib/[redacted].dart')
  })

  it('sends a request again only when the provider turned it away unread', async () => {
    const refused = (statusCode: number, responseBody = '', headers: Record<string, string> = {}) =>
      new APICallError({
        message: `status ${statusCode}`,
        url: 'https://api.example.com',
        requestBodyValues: {},
        statusCode,
        responseBody,
        responseHeaders: headers,
      })
    const answered = {
      content: [{ type: 'text' as const, text: 'Done.' }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    }
    const step = async (errors: Error[]) => {
      let calls = 0
      const waits: number[] = []
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          const err = errors[calls++]
          if (err) throw err
          return answered
        },
      })
      const out = await agentStep(
        'fix',
        { provider: 'anthropic', model: 'claude-sonnet-5-5' },
        {
          system: 's',
          messages: [{ role: 'user', content: 't' }],
          tools: [],
          maxOutputTokens: 100,
        },
        {
          log: async () => {},
          model: () => model,
          sleep: async (ms) => void waits.push(ms),
        },
      )
      return { out, calls, waits }
    }

    // too many at once, then overloaded: waited for, then answered
    const busy = await step([refused(429, '', { 'retry-after': '3' }), refused(529)])
    expect(busy.out?.text).toBe('Done.')
    expect(busy.calls).toBe(3)
    expect(busy.waits).toEqual([3000, 4000])

    // a failure that may have been charged: no second attempt here
    const broken = await step([refused(500)])
    expect(broken).toMatchObject({ out: null, calls: 1, waits: [] })

    // a quota that's used up won't come back by waiting
    const spent = await step([refused(429, '{"error":{"code":"insufficient_quota"}}')])
    expect(spent).toMatchObject({ out: null, calls: 1 })

    // and it gives up after four waits
    const always = await step(Array.from({ length: 10 }, () => refused(429)))
    expect(always).toMatchObject({ out: null, calls: 5 })
  })

  it('keeps what an answered step cost when its log fails', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text' as const, text: 'Done.' }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 50, text: 50, reasoning: 0 },
        },
        warnings: [],
      }),
    })
    const step = await agentStep(
      'fix',
      { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      { system: 's', messages: [{ role: 'user', content: 't' }], tools: [], maxOutputTokens: 100 },
      {
        log: async () => {
          throw new Error('llm_calls gone')
        },
        model: () => model,
      },
    )
    expect(step).toMatchObject({ inputTokens: 1000, outputTokens: 50, unlogged: 'llm_calls gone' })
    expect(step?.costUsd).toBeGreaterThan(0)
  })

  it('logs a failed step with the secret its error quoted taken out', async () => {
    const calls: LlmCall[] = []
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('400: bad request near hunter2-hunter2')
      },
    })
    const step = await agentStep(
      'fix',
      { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      { system: 's', messages: [{ role: 'user', content: 't' }], tools: [], maxOutputTokens: 100 },
      { log: async (c) => void calls.push(c), model: () => model, secrets: ['hunter2-hunter2'] },
    )
    expect(step).toBeNull()
    expect(calls[0]?.ok).toBe(false)
    expect(calls[0]?.error).toContain('[redacted]')
    expect(calls[0]?.error).not.toContain('hunter2')
  })
})
