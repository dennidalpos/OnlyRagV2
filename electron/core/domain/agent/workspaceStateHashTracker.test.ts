import { describe, it, expect } from 'vitest'
import { WorkspaceStateHashTracker } from './workspaceStateHashTracker'

describe('WorkspaceStateHashTracker', () => {
  it('should detect duplicate workspace file state hash', () => {
    const tracker = new WorkspaceStateHashTracker()
    const files = ['package.json']

    const check1 = tracker.recordAndCheckState(1, files)
    expect(check1.isStagnant).toBe(false)

    const check2 = tracker.recordAndCheckState(3, files)
    expect(check2.isStagnant).toBe(true)
    expect(check2.previousStep).toBe(1)
  })
})
