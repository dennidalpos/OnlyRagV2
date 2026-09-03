import { describe, expect, it } from 'vitest'
import { capPlanMilestones, MAX_PLAN_MILESTONES } from '../../../../shared/domain/agent/planMilestoneCapper'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'

function makePlan(titles: string[], statuses: PlanMilestone['status'][] = []): PlanMilestone[] {
  return titles.map((title, idx) => ({
    id: `m-${idx + 1}`,
    title,
    status: statuses[idx] || 'pending',
  }))
}

describe('capPlanMilestones', () => {
  it('leaves a plan already within the cap untouched', () => {
    const plan = makePlan(['Create package.json', 'Create src/App.tsx'])
    expect(capPlanMilestones(plan)).toBe(plan)
  })

  it('returns an empty plan for empty or non-array input', () => {
    expect(capPlanMilestones([])).toEqual([])
    expect(capPlanMilestones(undefined as unknown as PlanMilestone[])).toEqual([])
  })

  it('folds an over-long plan down to the cap, re-numbered sequentially', () => {
    const plan = makePlan(Array.from({ length: 21 }, (_, i) => `Task ${i + 1}`))
    const capped = capPlanMilestones(plan)

    expect(capped).toHaveLength(MAX_PLAN_MILESTONES)
    expect(capped.map((m) => m.id)).toEqual(Array.from({ length: 15 }, (_, i) => `m-${i + 1}`))
  })

  it('preserves every original requirement inside the merged titles', () => {
    const plan = makePlan(Array.from({ length: 21 }, (_, i) => `Task ${i + 1}`))
    const mergedTitles = capPlanMilestones(plan).map((m) => m.title).join('; ')

    for (let i = 1; i <= 21; i++) {
      expect(mergedTitles).toContain(`Task ${i}`)
    }
  })

  it('holds a trailing completion milestone out of the merge and keeps it last', () => {
    const titles = [...Array.from({ length: 20 }, (_, i) => `Task ${i + 1}`), 'Riepilogo finale e arresto (invoke finish)']
    const capped = capPlanMilestones(makePlan(titles))

    expect(capped).toHaveLength(MAX_PLAN_MILESTONES)
    expect(capped[capped.length - 1].title).toBe('Riepilogo finale e arresto (invoke finish)')
    expect(capped[capped.length - 1].id).toBe('m-15')
  })

  it('merges consecutive milestones rather than reordering them', () => {
    const capped = capPlanMilestones(makePlan(['a', 'b', 'c', 'd', 'e']), 2)
    expect(capped.map((m) => m.title)).toEqual(['a; b; c', 'd; e'])
  })

  it('reports a merged group as verified only when every member is verified', () => {
    const plan = makePlan(['a', 'b', 'c', 'd'], ['verified', 'verified', 'pending', 'pending'])
    const capped = capPlanMilestones(plan, 2)

    expect(capped[0].status).toBe('verified')
    expect(capped[1].status).toBe('pending')
  })

  it('reports a merged group as failed when any member failed', () => {
    const plan = makePlan(['a', 'b'], ['verified', 'failed'])
    expect(capPlanMilestones(plan, 1)[0].status).toBe('failed')
  })

  it('reports partial progress inside a merged group as in_progress', () => {
    const plan = makePlan(['a', 'b'], ['verified', 'pending'])
    expect(capPlanMilestones(plan, 1)[0].status).toBe('in_progress')
  })

  it('carries the first verification command and hypothesis of a merged group forward', () => {
    const plan: PlanMilestone[] = [
      { id: 'm-1', title: 'a', status: 'pending' },
      { id: 'm-2', title: 'b', status: 'pending', verificationCommand: 'npm run build', falsifiableHypothesis: 'build passes' },
      { id: 'm-3', title: 'c', status: 'pending', verificationCommand: 'npm test' },
    ]
    const merged = capPlanMilestones(plan, 1)[0]

    expect(merged.verificationCommand).toBe('npm run build')
    expect(merged.falsifiableHypothesis).toBe('build passes')
  })

  it('clamps a nonsensical cap to at least one milestone', () => {
    expect(capPlanMilestones(makePlan(['a', 'b', 'c']), 0)).toHaveLength(1)
  })
})
