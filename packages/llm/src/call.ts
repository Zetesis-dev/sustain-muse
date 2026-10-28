import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { redact } from './redact.ts'
import type { LoggedTask, ModelRef, Provider, Route } from './router.config.ts'

// What every model call shares: its log line, its options, the live
// providers, and how a failure is put into words.

export type LlmCall = {
  task: LoggedTask
  provider: Provider
  model: string
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number
  ok: boolean
  error: string | null
}

export type CompleteOptions = {
  log: (call: LlmCall) => Promise<void>
  // stored secrets to strip, beyond the known key formats
  secrets?: string[]
  // tests hand in their own models, and their own route
  model?: (ref: ModelRef) => LanguageModel
  route?: Route
  env?: Record<string, string | undefined>
  // tests skip the waits between requests the provider turned away
  sleep?: (ms: number) => Promise<void>
}

// Meta's Model API (dev.meta.ai/docs/protocols), spoken to as OpenAI's
// Chat Completions: stateless, so each call carries the whole conversation
// and no turn depends on what Meta keeps of the last
const META_API = 'https://api.meta.ai/v1'

export function liveModel(ref: ModelRef, env: Record<string, string | undefined>): LanguageModel {
  if (ref.provider === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    return createAnthropic({ apiKey })(ref.model)
  }
  if (ref.provider === 'meta') {
    const apiKey = env.META_AI_API_KEY
    if (!apiKey) throw new Error('META_AI_API_KEY is not set')
    return createOpenAI({ apiKey, baseURL: META_API }).chat(ref.model)
  }
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
  return createOpenAI({ apiKey })(ref.model)
}

// What a call tells the provider beyond the prompt: how hard a reasoning
// model thinks. The SDK sends that only for OpenAI models it knows reason,
// so Meta's Muse, which it doesn't know, is told it does, its system
// prompt kept a system message
export function providerOptions(ref: ModelRef) {
  if (!ref.reasoning) return undefined
  const effort = { reasoningEffort: ref.reasoning }
  return ref.provider === 'meta'
    ? { openai: { ...effort, forceReasoning: true, systemMessageMode: 'system' } }
    : { openai: effort }
}

// What a provider said went wrong, without its body: status words only,
// redacted, since an error can quote what it was sent.
export const reason = (err: unknown, secrets?: string[]) =>
  redact((err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' '), secrets).slice(
    0,
    300,
  )
