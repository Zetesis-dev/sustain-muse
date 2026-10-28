import { readFileSync } from 'node:fs'
import { TASK_CLASSES } from '@sustain/core/checks'
import { describe, expect, it } from 'vitest'
import { BAR, BAR_ECOSYSTEMS, BAR_TASK_CLASSES, clearsBar } from './bar.ts'

// The bar is a decision, not a measurement: these are docs/decisions.md
// 2026-10-25's "opens PRs" rows, and a change here is a change there.

describe("each ecosystem's bar", () => {
  it('is the table decided on 2026-10-25', () => {
    expect(BAR).toEqual({ dart: ['dependency_bump'], node: ['dependency_bump', 'sdk_migration'] })
  })

  it('ranges over the task classes Sustain has, in both ecosystems the analyzer names', () => {
    expect(BAR_TASK_CLASSES).toEqual(TASK_CLASSES)
    expect(BAR_ECOSYSTEMS).toEqual(['dart', 'node'])
    expect(Object.keys(BAR).sort()).toEqual([...BAR_ECOSYSTEMS])
  })

  it('lets a class through only where it cleared, and nothing it does not know', () => {
    const cleared = BAR_ECOSYSTEMS.flatMap((e) =>
      BAR_TASK_CLASSES.filter((k) => clearsBar(e, k)).map((k) => `${e}:${k}`),
    )
    expect(cleared).toEqual(['dart:dependency_bump', 'node:dependency_bump', 'node:sdk_migration'])
    for (const [ecosystem, taskClass] of [
      ['flutter', 'dependency_bump'],
      ['Node', 'dependency_bump'],
      ['node', 'Dependency_bump'],
      ['__proto__', 'dependency_bump'],
      ['constructor', 'dependency_bump'],
      ['node', 'toString'],
      ['', ''],
    ] as const)
      expect(clearsBar(ecosystem, taskClass)).toBe(false)
  })

  it("can't be changed at run time", () => {
    expect(Object.isFrozen(BAR)).toBe(true)
    for (const e of BAR_ECOSYSTEMS) expect(Object.isFrozen(BAR[e])).toBe(true)
  })

  it('imports nothing, so the dashboard and the Worker can read it alone', () => {
    const source = readFileSync(new URL('./bar.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/^\s*import\b|\bfrom\s+['"]|\brequire\(|\bimport\(/m)
  })
})
