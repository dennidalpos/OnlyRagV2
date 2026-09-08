import { describe, expect, it } from 'vitest'
import {
  MAX_PROMPT_MILESTONES,
  selectPromptMilestoneWindow,
} from '../../../../shared/domain/agent/planPromptWindow'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'

function makePlan(length: number): PlanMilestone[] {
  return Array.from({ length }, (_, index) => ({
    id: `m-${index + 1}`,
    title: `Task ${index + 1}`,
    status: 'pending',
    verificationCommand: `check-${index + 1}`,
  }))
}

describe('selectPromptMilestoneWindow', () => {
  it('returns the original identities when the plan fits', () => {
    const plan = makePlan(2)
    const window = selectPromptMilestoneWindow(plan, 'm-1')

    expect(window.entries.map((entry) => entry.milestone)).toEqual(plan)
    expect(window.omittedBefore).toBe(0)
    expect(window.omittedAfter).toBe(0)
  })

  it('limits only prompt presentation and keeps the active milestone visible', () => {
    const plan = makePlan(21)
    const window = selectPromptMilestoneWindow(plan, 'm-16')

    expect(window.entries).toHaveLength(MAX_PROMPT_MILESTONES)
    expect(window.entries.some((entry) => entry.milestone === plan[15])).toBe(true)
    expect(window.omittedBefore + window.entries.length + window.omittedAfter).toBe(plan.length)
  })

  it('does not renumber or merge commands in the visible slice', () => {
    const plan = makePlan(21)
    const window = selectPromptMilestoneWindow(plan, 'm-2')

    expect(window.entries.map((entry) => entry.milestone.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `m-${index + 1}`)
    )
    expect(window.entries.map((entry) => entry.milestone.verificationCommand)).toEqual(
      Array.from({ length: 15 }, (_, index) => `check-${index + 1}`)
    )
    expect(window.omittedAfter).toBe(6)
  })
})
