import { describe, it, expect } from 'vitest'
import { parsePlanChecklist } from './planChecklistParser'
import type { AgentPlan } from '../../hooks/usePlanApproval'

describe('PlanChatApprovalCard and Checklist Parser Unit Tests', () => {
  it('should parse pre-computed milestones into checklist items correctly', () => {
    const plan: AgentPlan = {
      id: 'plan_1',
      version: 1,
      prompt: 'Implement auth module',
      planText: '1. Setup auth\n2. Add JWT\n3. Verify tests',
      status: 'ready',
      createdAt: new Date().toISOString(),
      milestones: [
        { id: 'm1', title: 'Setup auth', status: 'pending' },
        { id: 'm2', title: 'Add JWT', status: 'in_progress' },
        { id: 'm3', title: 'Verify tests', status: 'verified' },
      ],
    }

    const items = parsePlanChecklist(plan)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({ id: 'm1', title: 'Setup auth', completed: false })
    expect(items[1]).toEqual({ id: 'm2', title: 'Add JWT', completed: false })
    expect(items[2]).toEqual({ id: 'm3', title: 'Verify tests', completed: true })
  })

  it('should fallback to parsing numbered text when milestones are omitted', () => {
    const plan: Pick<AgentPlan, 'planText' | 'milestones'> = {
      planText: '1. First step\n2. Second step\n3. Final step',
    }

    const items = parsePlanChecklist(plan)
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(items[0].title).toContain('First step')
    expect(items[1].title).toContain('Second step')
  })

  it('should return empty array for empty or null plan', () => {
    expect(parsePlanChecklist(null)).toEqual([])
    expect(parsePlanChecklist({ planText: '' })).toEqual([])
  })
})
