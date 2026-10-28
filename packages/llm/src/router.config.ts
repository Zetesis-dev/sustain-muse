// Which model does which job (TECH_STACK.md 3.10). Model IDs live only here,
// and change only with an eval run attached: each task names the run that
// chose its models.

// meta: Meta's Muse models, for the Meta Global AI Developer Hackathon
// (docs/decisions.md 2026-10-26)
export type Provider = 'anthropic' | 'openai' | 'meta'
// reasoning: how hard an OpenAI or a Muse reasoning model thinks; each
// family names its lowest setting differently (gpt-5: minimal, gpt-5.1 on:
// none; Muse refuses none)
export type ModelRef = { provider: Provider; model: string; reasoning?: 'none' | 'minimal' | 'low' }
export type TaskClass =
  | 'summarize_finding'
  | 'profile_summary'
  | 'lesson_example'
  | 'rule_check'
  | 'rule_confirm'
  | 'change_draft'
// an agent run's work (BUILD_PLAN.md P7). Each run names its own model while
// the evals compare them; the router's routes for these come from the
// baseline those evals record
export type AgentTask = 'fix' | 'upgrade' | 'test_writing'
// embeddings are logged under their own task
export type LoggedTask = TaskClass | AgentTask | 'embed_code'

// USD per million tokens, standard tier, read from each provider's pricing
// page on 2026-10-02 (platform.claude.com/docs/en/about-claude/pricing,
// developers.openai.com/api/docs/pricing); Opus 5.5 and the embeddings model
// on 2026-10-03.
// cachedInput: what an input token the provider read from its own cache
// costs, where it says; a model without one is priced at the full rate
export const PRICES: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  // Meta's standard mode, in which nothing sent trains Meta's models (never
  // its contributor mode), from dev.meta.ai/docs/pricing-rate-limits on
  // 2026-10-26; reasoning is billed as output. Meta caches a repeated
  // prompt on its own, as an agent's turns repeat theirs
  'muse-spark-1.3': { input: 1.25, output: 4.25, cachedInput: 0.15 },
  'muse-wonder-1.0': { input: 4, output: 20, cachedInput: 0.2 },
}

// Code is embedded with this model, at this size; code_chunks.embedding is
// vector(1536) to match (migration 0038).
export const EMBEDDINGS = {
  provider: 'openai' as const,
  model: 'text-embedding-3-small',
  dimensions: 1536,
  chosenBy: 'evals/profiles/results.md',
}

// fallback: the model to try when the primary can't answer; null when no
// other model passed the task's eval, so a failure leaves the written
// alternative in place
export type Route = { primary: ModelRef; fallback: ModelRef | null; chosenBy: string }

export const ROUTER: Record<TaskClass, Route> = {
  // the cheapest model that passes the hand-graded summary set. Yuvi's
  // grades, 2026-10-03: Claude Haiku 4.5 15 of 16, and its one miss also
  // failed the voice check, so the rule's own words show there instead;
  // gpt-5-nano 12, gpt-4.1-nano 11 (14 failed the voice check), gpt-5.4-nano
  // 10. Only Haiku passed, so no other model stands in for it
  summarize_finding: {
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    fallback: null,
    chosenBy: 'evals/summaries/results.md',
  },
  // the profile's summary and sections, from what the analyzer read. The
  // plan asks for a strong model here (BUILD_PLAN.md P6): Sonnet 5.5 is the
  // cheapest that passed every run, and read the code deepest. gpt-5.4-mini
  // also passed every run, on another provider, so it stands in; Haiku 4.5
  // missed a fragile area in two of three
  profile_summary: {
    primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    fallback: { provider: 'openai', model: 'gpt-5.4-mini', reasoning: 'low' },
    chosenBy: 'evals/profiles/results.md',
  },
  // a lesson's example, copied from the app's own code: the cheapest model
  // whose every example passed, with Sonnet 5.5, which passed every one
  // too, on the other provider. Haiku 4.5 passed 7 of 10, and once copied
  // lines that showed something else
  lesson_example: {
    primary: { provider: 'openai', model: 'gpt-5.4-mini', reasoning: 'low' },
    fallback: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    chosenBy: 'evals/lessons/results.md',
  },
  // an llm rule's first read of a piece of code: the cheapest model that
  // judged all 17 cases right in both runs, 2026-10-04. Every candidate did,
  // once the pieces held the 30 lines above each match; Haiku 4.5 is the
  // cheapest on the other provider
  rule_check: {
    primary: { provider: 'openai', model: 'gpt-5.4-nano', reasoning: 'low' },
    fallback: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    chosenBy: 'evals/rules/results.md',
  },
  // the second read, only of pieces the first said break the rule, since a
  // finding needs both: the strongest model that judged every case right,
  // with the strongest on the other provider that did
  rule_confirm: {
    primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    fallback: { provider: 'openai', model: 'gpt-5.4-mini', reasoning: 'low' },
    chosenBy: 'evals/rules/results.md',
  },
  // a vendor change and its rule, drafted from the vendor's own text for a
  // person to review (P7b's watcher): the cheapest model that drafted all
  // 12 cases right in both runs, 2026-10-14, with the prompt's exact outline
  // and room for a long list of models. Opus 5.5 did too, so it stands in;
  // gpt-5.4-mini passed 17 of 24 and Haiku 4.5 18, missing what a release
  // applies to
  change_draft: {
    primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    fallback: { provider: 'anthropic', model: 'claude-opus-5-5' },
    chosenBy: 'evals/drafts/results.md',
  },
}

// An agent run's model, by its work (BUILD_PLAN.md P7), from each
// ecosystem's baseline (P7c): Flutter's evals/results/2026-10-25-4.json and
// Node's 2026-10-25-3.json, two runs a case, every case judged in a fresh
// sandbox. The model that passed most of its classes' runs, the cheaper on
// a tie, and the best on the other provider behind it, for when the first
// can't answer. P8's per-class bar (docs/decisions.md) decides which
// classes may open pull requests at all.
export const AGENT_ROUTER: Record<AgentTask, Route> = {
  // dependency bumps, SDK migrations, routine upgrades: on Node Sonnet 5.5
  // and Opus 5.5 each passed 26 of 28 runs, Sonnet at 20 cents a run
  // against Opus's 46; on Flutter Sonnet passed 21 of 22, Opus 20, at 33
  // cents against 57. gpt-5.4-mini passed 24 and 16
  upgrade: {
    primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    fallback: { provider: 'openai', model: 'gpt-5.4-mini', reasoning: 'low' },
    chosenBy: 'evals/RESULTS.md',
  },
  // deprecated APIs, config drift, lint fixes: Sonnet 5.5 and Opus 5.5 each
  // passed 10 of 12 on Flutter and 4 of 4 on Node, Sonnet at about half the
  // cost. gpt-5.4-mini passed 6 and 3: in four Flutter deprecated-API runs
  // it also changed a file the task didn't need, so it stands in only when
  // Sonnet can't answer
  fix: {
    primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    fallback: { provider: 'openai', model: 'gpt-5.4-mini', reasoning: 'low' },
    chosenBy: 'evals/RESULTS.md',
  },
  // every model's tests passed on the code and caught the mutation, all 4
  // runs: gpt-5.4-mini is the cheapest, at 3 cents a run
  test_writing: {
    primary: { provider: 'openai', model: 'gpt-5.4-mini', reasoning: 'low' },
    fallback: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    chosenBy: 'evals/RESULTS.md',
  },
}

// A class of agent work in one ecosystem, whose task names at most so many
// files, with a route of its own apart from its work's, chosen by that
// class's own runs (D03: a class clears its bar in each ecosystem on its
// own). A task that names no file takes its work's route
export type ClassRoute = {
  taskClass: string
  ecosystem: 'node' | 'dart'
  maxFiles: number
  route: Route
}

export const CLASS_ROUTES: ClassRoute[] = [
  // Node SDK migrations whose task names 3 files or fewer: Muse Spark 1.3
  // and Sonnet 5.5 each passed 14 of 14, at 8.17 and 8.04 cents a run
  // (evals/results/2026-10-27.json, against 2026-10-25-3.json). Sonnet
  // edges that tie by a tenth of a cent; Yuvi gave it to Muse on 2026-10-27,
  // for equal work at equal cost, a second provider, and the Meta Global AI
  // Developer Hackathon. The one larger case (8 files) Spark passed once in
  // two, Sonnet twice, so larger ones stay with the work's route
  {
    taskClass: 'sdk_migration',
    ecosystem: 'node',
    maxFiles: 3,
    route: {
      primary: { provider: 'meta', model: 'muse-spark-1.3', reasoning: 'low' },
      fallback: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      chosenBy: 'evals/muse-node-sdk.md',
    },
  },
]

// An agent run's route: its class's own, where one covers its ecosystem and
// the number of files its task names, else its work's
export function agentRoute(
  work: AgentTask,
  taskClass: string,
  ecosystem: 'node' | 'dart',
  files: number,
): Route {
  const own = CLASS_ROUTES.find(
    (c) =>
      c.taskClass === taskClass && c.ecosystem === ecosystem && files >= 1 && files <= c.maxFiles,
  )
  return own?.route ?? AGENT_ROUTER[work]
}

// How many of a call's input tokens to take as read from the provider's
// cache: the count it gave, when that count can be true (whole, and none
// past the input); otherwise none, so usage that contradicts itself is
// priced and counted as if nothing came from cache, the most it could be
export function cachedOf(inputTokens: number, cached: number | undefined): number {
  return cached !== undefined && Number.isInteger(cached) && cached >= 0 && cached <= inputTokens
    ? cached
    : 0
}

// cached: how many of inputTokens the provider read from its cache, at the
// cached rate where PRICES gives one (cachedOf). Left out, every token is at
// the full rate, the most a call could cost
export function costOf(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cached = 0,
): number | null {
  const p = PRICES[model]
  if (!p) return null
  const fromCache = p.cachedInput === undefined ? 0 : cachedOf(inputTokens, cached)
  return (
    ((inputTokens - fromCache) * p.input +
      fromCache * (p.cachedInput ?? 0) +
      outputTokens * p.output) /
    1_000_000
  )
}
