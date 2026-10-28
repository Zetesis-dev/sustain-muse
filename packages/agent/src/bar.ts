// Each ecosystem's bar (BUILD_PLAN.md P8, docs/p8-prep.md section 3): the
// task classes whose routed model passed 80 percent of its runs there, over
// at least six cases, with no file touched outside the scope. Only these
// get a fix queued in that ecosystem. From the table in docs/decisions.md
// 2026-10-25, and changed only with a decision. It imports nothing, so the
// Worker and the dashboard can read it without the agent's loop.

// the classes it ranges over, as @sustain/core's TASK_CLASSES (bar.test.ts
// keeps the two the same)
export const BAR_TASK_CLASSES = [
  'dependency_bump',
  'sdk_migration',
  'deprecated_api',
  'config_drift',
  'lint_fix',
  'routine_upgrade',
  'test_writing',
] as const
export type BarTaskClass = (typeof BAR_TASK_CLASSES)[number]

// as the analyzer names them: dart is Flutter's
export const BAR_ECOSYSTEMS = ['dart', 'node'] as const
export type BarEcosystem = (typeof BAR_ECOSYSTEMS)[number]

// the classes that cleared the bar, in each ecosystem
export const BAR: Readonly<Record<BarEcosystem, readonly BarTaskClass[]>> = Object.freeze({
  dart: Object.freeze(['dependency_bump'] as const),
  node: Object.freeze(['dependency_bump', 'sdk_migration'] as const),
})

// Whether a class cleared the bar in an ecosystem. Anything it doesn't
// know, as either, hasn't
export const clearsBar = (ecosystem: string, taskClass: string): boolean =>
  Object.hasOwn(BAR, ecosystem) &&
  (BAR[ecosystem as BarEcosystem] as readonly string[]).includes(taskClass)
