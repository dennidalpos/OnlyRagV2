import { describe, it, expect } from 'vitest'
import { PlanManager } from './planManager'
import type { PlanMilestone } from './planAndSolveGraph'

describe('PlanManager', () => {
  const sampleMilestones: PlanMilestone[] = [
    { id: 'm-1', title: 'Create auth types', status: 'pending' },
    { id: 'm-2', title: 'Configure JWT middleware', status: 'verified' },
  ]

  it('should compute compact state directly from PlanMilestone[]', () => {
    const compactState = PlanManager.getCompactStateFromMilestones(sampleMilestones, 'Add Authentication Feature')

    expect(compactState.objective).toBe('Add Authentication Feature')
    expect(compactState.restorePoint).toBe('m-2: Configure JWT middleware')
    expect(compactState.activeMicroTask).toBe('m-1: Create auth types')
    expect(compactState.pendingMicroTasks).toHaveLength(1)
    expect(compactState.pendingMicroTasks[0]).toBe('m-1: Create auth types')
    expect(compactState.completedCount).toBe(1)
    expect(compactState.totalCount).toBe(2)
    expect(compactState.isCompleted).toBe(false)
  })

  it('should mark plan as completed when every milestone is verified', () => {
    const allVerified: PlanMilestone[] = sampleMilestones.map((m) => ({ ...m, status: 'verified' }))
    const compactState = PlanManager.getCompactStateFromMilestones(allVerified)

    expect(compactState.isCompleted).toBe(true)
    expect(compactState.pendingMicroTasks).toHaveLength(0)
    expect(compactState.activeMicroTask).toBe('None (Plan Completed)')
  })

  it('should handle an empty milestone list', () => {
    const compactState = PlanManager.getCompactStateFromMilestones([], 'Empty Objective')

    expect(compactState.totalCount).toBe(0)
    expect(compactState.completedCount).toBe(0)
    expect(compactState.isCompleted).toBe(false)
    expect(compactState.restorePoint).toBe('None (Session Initialized)')
  })

})
