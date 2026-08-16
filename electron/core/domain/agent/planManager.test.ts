import { describe, it, expect } from 'vitest'
import { PlanManager } from './planManager'

describe('PlanManager', () => {
  const samplePlanMarkdown = `# Implementation Plan: Add Authentication Feature

## 1. Architectural Summary & Scope
Implements JWT authentication in auth service.

## 2. Execution Checklist
- [ ] **Task 1: Create auth types**
  - **Files:** \`src/auth/types.ts\`, \`src/auth/constants.ts\`
  - **Instructions:** Define User and Token interfaces.
  - **Verification Command:** \`npm test src/auth/types.test.ts\`
  - **Success Criteria:** Exit code 0

- [x] **Task 2: Configure JWT middleware**
  - **Files:** \`src/auth/middleware.ts\`
  - **Instructions:** Implement verification middleware.
  - **Verification Command:** \`npm test src/auth/middleware.test.ts\`
  - **Success Criteria:** Tests pass

## 3. Final Verification
- **Global Command:** \`npm test\`
`

  it('should accurately parse structured plan markdown', () => {
    const doc = PlanManager.parsePlanMarkdown(samplePlanMarkdown)
    expect(doc.title).toBe('Add Authentication Feature')
    expect(doc.scopeSummary).toContain('JWT authentication')
    expect(doc.tasks).toHaveLength(2)
    expect(doc.globalVerificationCommand).toBe('npm test')

    expect(doc.tasks[0].id).toBe(1)
    expect(doc.tasks[0].completed).toBe(false)
    expect(doc.tasks[0].files).toEqual(['src/auth/types.ts', 'src/auth/constants.ts'])
    expect(doc.tasks[0].verificationCommand).toBe('npm test src/auth/types.test.ts')

    expect(doc.tasks[1].id).toBe(2)
    expect(doc.tasks[1].completed).toBe(true)
  })

  it('should find next pending task', () => {
    const doc = PlanManager.parsePlanMarkdown(samplePlanMarkdown)
    const nextTask = PlanManager.getNextPendingTask(doc)
    expect(nextTask).not.toBeNull()
    expect(nextTask?.id).toBe(1)
  })

  it('should mark task completed and detect plan completion', () => {
    const doc = PlanManager.parsePlanMarkdown(samplePlanMarkdown)
    expect(PlanManager.isPlanComplete(doc)).toBe(false)

    const updated = PlanManager.markTaskCompleted(doc, 1)
    expect(PlanManager.isPlanComplete(updated)).toBe(true)
    expect(PlanManager.getNextPendingTask(updated)).toBeNull()
  })

  it('should serialize plan back to clean markdown', () => {
    const doc = PlanManager.parsePlanMarkdown(samplePlanMarkdown)
    const serialized = PlanManager.serializePlanMarkdown(doc)
    expect(serialized).toContain('# Implementation Plan: Add Authentication Feature')
    expect(serialized).toContain('- [ ] **Task 1: Create auth types**')
    expect(serialized).toContain('- [x] **Task 2: Configure JWT middleware**')
    expect(serialized).toContain('- **Global Command:** `npm test`')
  })

  it('should compute compact state and generate session tracker markdown', () => {
    const doc = PlanManager.parsePlanMarkdown(samplePlanMarkdown)
    const compactState = PlanManager.getCompactState(doc, 'Add Authentication Feature')

    expect(compactState.objective).toBe('Add Authentication Feature')
    expect(compactState.restorePoint).toBe('Task 2: Configure JWT middleware')
    expect(compactState.activeMicroTask).toBe('Task 1: Create auth types')
    expect(compactState.pendingMicroTasks).toHaveLength(1)
    expect(compactState.pendingMicroTasks[0]).toBe('Task 1: Create auth types')
    expect(compactState.completedCount).toBe(1)
    expect(compactState.totalCount).toBe(2)
    expect(compactState.isCompleted).toBe(false)

    const trackerMarkdown = PlanManager.generateSessionTrackerMarkdown(compactState)
    expect(trackerMarkdown).toContain('# SESSION TRACKER')
    expect(trackerMarkdown).toContain('## Objective')
    expect(trackerMarkdown).toContain('Add Authentication Feature')
    expect(trackerMarkdown).toContain('## Restore Point')
    expect(trackerMarkdown).toContain('Task 2: Configure JWT middleware')
    expect(trackerMarkdown).toContain('## Active Micro-Task')
    expect(trackerMarkdown).toContain('Task 1: Create auth types')
    expect(trackerMarkdown).toContain('- [ ] Task 1: Create auth types')
    expect(trackerMarkdown).toContain('[STOP DIRECTIVE]')
  })
})
