# Decisions

The entries from Sustain's decision log that brought in the Muse models, each copied whole.

## 2026-10-27: Small Node SDK migrations go to Muse Spark

Yuvi's call, 2026-10-27, on the evals in evals/muse-node-sdk.md.

- **A class can have a route of its own** in one ecosystem, for tasks that
  name up to so many files (`CLASS_ROUTES`, `agentRoute` in
  packages/llm/src/router.config.ts). A fix's task names its finding's
  files and, when a package must move, the manifest, so its size is known
  before the agent runs. A task naming no file takes its work's route.
- **Node SDK migrations naming 3 files or fewer run on Muse Spark 1.3**,
  with Sonnet 5.5 as the route's fallback. On those cases both passed 14 of
  14, Spark at $0.0817 a run and Sonnet at $0.0804. That tie, which Sonnet
  edges by a tenth of a cent, went to Muse: equal work at equal cost, a
  second provider, and the Meta Global AI Developer Hackathon. The one
  larger case, 8 files, Spark passed once in two and Sonnet twice, so
  larger ones stay on the upgrade route. Spark's two runs of it were taken
  one at a time, each into evals/results/2026-10-27-2.json, so the file
  and evals/muse-node-sdk.md keep only the second, which used all 40 of
  its steps; the first passed, 7 files, $0.43, as its log said
  ("checks pass, 7 files (+53 -35), $0.43, 395s"). The rot lab's SUS-0081
  names 2.
- **The size is only what the finding vouches for.** A finding keeps at
  most 10 matches a component, and the analyzer 10 a detector, saying
  nothing of what it dropped. So a fix whose finding left matches out, or
  kept 10 in its component, counts as naming no file, and takes the work's
  route (Codex, 2026-10-27).
- **A fix run uses its route's primary only**, as before: when Meta can't
  answer, the run ends without a fix, as it does when Anthropic can't.
- **Production has no Meta key.** Its write allowlist is empty, so no fix
  runs there, and the DPA promises 30 days' notice before a subprocessor
  sees customers' code. The key goes to production's Trigger with that
  notice, before Maintain takes any customer.

## 2026-10-27: A run's token budget counts what it reads for the first time

The P7 exit record carried forward "a run's 600k input tokens, which three
runs on the largest repository reached". Of the 13 Muse runs that failed
the replay evals (evals/muse.md), 12 stopped there before they finished,
and the 13th changed files outside its task. The same runs cost Meta
about a third of what they were priced at.

- **The 600,000 tokens are the ones a run reads for the first time.** Each
  turn resends the conversation; what the provider reads back from its own
  cache was sent, and counted, on an earlier turn, and bills at a tenth of
  the price. A model whose calls aren't cached (Claude's, as we call it) is
  counted as before, every token of every turn.
- **The cost cap is unchanged** and still projects the next turn at the
  full rate, the most it could cost. A cache that lapses mid-run can carry
  one turn past the token budget, never past the dollar budget.
- **A call's cost** prices what was read from cache at the provider's
  cached rate, where PRICES gives one (Muse's), and in full where not.
- **A cached count that can't be true counts as none** (`cachedOf`): more
  than the call read, negative, or not whole. Usage that contradicts itself
  is priced and counted in full, the most it could be, rather than taken at
  the deepest discount (Codex, 2026-10-27).

## 2026-10-26: Meta's Muse models, a third provider

Yuvi's call, 2026-10-26: Sustain is in the Meta Global AI Developer
Hackathon's startup track (Oct 26 to Nov 4), and Muse models are measured
for the work they'd do, with $20 of pay-as-you-go spend for testing. This
changes TECH_STACK.md 3.10's providers, and nothing that's routed.

- **Meta is a provider beside Anthropic and OpenAI**, reached through the
  same OpenAI SDK package at `https://api.meta.ai/v1` as Chat Completions,
  so no dependency is added. The key is `META_AI_API_KEY`. llm_calls and
  runs take `meta` as a provider (migration 0066).
- **Standard mode only.** In Meta's contributor mode what's sent may train
  Meta's models; that's never used, for customers' code or for our eval
  sets, whose later scores would mean less.
- **The routes don't change yet.** As with every model, a Muse model takes
  a route only with an eval run attached: `pnpm evals --models spark` or
  `wonder` runs the replay evals on muse-spark-1.3 or muse-wonder-1.0. The
  YC demo stays on Sonnet until it's recorded, whatever those show.
- **Customers' code reaches Meta only after notice.** The DPA promises 30
  days' email notice before a subprocessor is added, and Meta isn't on the
  list. Until then only fixes on apps Zetesis owns (the rot lab, and fixes
  are internal on Maintain) and the evals, on public repositories, may use
  a Muse model.
- **Reasoning effort** goes to Muse as it goes to OpenAI's reasoning
  models: the SDK is told Muse reasons (it doesn't know the model) and keeps
  the system prompt a system message.
