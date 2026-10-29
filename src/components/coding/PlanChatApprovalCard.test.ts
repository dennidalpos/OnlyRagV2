import { describe, expect, it } from 'vitest'
import { parsePlanChecklist } from './planChecklistParser'
import type { AgentPlan } from '../../hooks/usePlanApproval'

describe('PlanChecklistParser', () => {
  it('derives checklist items from structured interventions', () => {
    const plan = {
      milestones: [
        { id: 'm1', title: 'Setup auth', status: 'pending' },
        { id: 'm2', title: 'Add JWT', status: 'in_progress' },
        { id: 'm3', title: 'Verify tests', status: 'verified' },
      ],
    } satisfies Pick<AgentPlan, 'milestones'>

    expect(parsePlanChecklist(plan)).toEqual([
      { id: 'm1', title: 'Setup auth', completed: false, status: 'pending' },
      { id: 'm2', title: 'Add JWT', completed: false, status: 'in_progress' },
      { id: 'm3', title: 'Verify tests', completed: true, status: 'verified' },
    ])
  })

  it('does not infer interventions from display text', () => {
    expect(parsePlanChecklist(null)).toEqual([])
    expect(parsePlanChecklist({ milestones: [] })).toEqual([])
  })
})
