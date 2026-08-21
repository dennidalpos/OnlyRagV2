import { describe, it, expect, beforeEach } from 'vitest'
import { AgentExecutionGuard } from './agentExecutionGuard'

describe('AgentExecutionGuard Unified Domain Unit Tests', () => {
  let guard: AgentExecutionGuard

  beforeEach(() => {
    guard = new AgentExecutionGuard()
  })

  it('should detect duplicate tool action loop', () => {
    const toolCall = {
      tool: 'read_file' as const,
      parameters: { filePath: 'src/main.ts' },
    }

    expect(guard.checkLoop(toolCall).isLooping).toBe(false)
    expect(guard.checkLoop(toolCall).isLooping).toBe(false)
    const result = guard.checkLoop(toolCall)
    expect(result.isLooping).toBe(true)
    expect(result.suggestedIntervention).toContain('CRITICAL')
  })

  it('should track stagnation and trigger circuit breaker', () => {
    for (let i = 0; i < 7; i++) {
      expect(guard.checkStagnation(false, false).shouldBreak).toBe(false)
    }
    const res = guard.checkStagnation(false, false)
    expect(res.shouldBreak).toBe(true)
    expect(res.reason).toContain('No-mutation stagnation streak limit reached')
  })

  it('should validate task completion requirements (DoD)', () => {
    const invalidReq = {
      requireVerifiedBuild: true,
      hasVerifiedBuild: false,
      pendingMilestonesCount: 0,
      hasFileMutations: true,
    }
    const check1 = guard.validateTaskCompletion(invalidReq)
    expect(check1.allowed).toBe(false)
    expect(check1.reason).toContain('No Verified Build Execution')

    const validReq = {
      requireVerifiedBuild: true,
      hasVerifiedBuild: true,
      pendingMilestonesCount: 0,
      hasFileMutations: true,
    }
    const check2 = guard.validateTaskCompletion(validReq)
    expect(check2.allowed).toBe(true)
  })
})
