import { describe, expect, it } from 'vitest'
import { AgentRunMetrics, assertZeroFalseVerified } from './agentRunMetrics'

describe('AgentRunMetrics', () => {
  it('tracks tool, safety, recovery, verification and task outcome counters', () => {
    const metrics = new AgentRunMetrics('run-a')
    metrics.recordToolCall()
    metrics.recordToolCall(false)
    metrics.recordToolResult(true, '', 'write_file')
    metrics.recordToolResult(false, '[POLICY BLOCK] unsafe target', 'rollback_workspace')
    metrics.recordFalseVerified()
    metrics.recordTaskOutcome(false)

    expect(metrics.snapshot()).toEqual({
      sessionId: 'run-a',
      taskSuccess: false,
      toolCalls: 2,
      successfulToolCalls: 1,
      failedToolCalls: 1,
      unsafeActions: 1,
      recoveryActions: 1,
      validToolCalls: 1,
      invalidToolCalls: 1,
      falseVerified: 1,
    })
  })

  it('keeps counters isolated between run instances', () => {
    const first = new AgentRunMetrics('run-a')
    const second = new AgentRunMetrics('run-b')
    first.recordToolCall()
    first.recordTaskOutcome(true)

    expect(second.snapshot()).toMatchObject({ sessionId: 'run-b', toolCalls: 0, taskSuccess: null })
    expect(first.snapshot()).toMatchObject({ sessionId: 'run-a', toolCalls: 1, taskSuccess: true })
  })

  it('blocks the controlled fixture suite when any run reports false verification', () => {
    const cleanRun = new AgentRunMetrics('clean-run')
    expect(() => assertZeroFalseVerified([cleanRun.snapshot()])).not.toThrow()

    const invalidRun = new AgentRunMetrics('invalid-run')
    invalidRun.recordFalseVerified()
    expect(() => assertZeroFalseVerified([cleanRun.snapshot(), invalidRun.snapshot()])).toThrow(
      'False verification threshold exceeded in 1 run(s).',
    )
  })
})
