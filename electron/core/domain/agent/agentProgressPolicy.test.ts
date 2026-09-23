import { describe, expect, it } from 'vitest'
import { AgentProgressPolicy, PROGRESS_BUDGET, schemaStopSummary, type LoopBlockContext } from './agentProgressPolicy'

const UNLIMITED: LoopBlockContext = { canAdvanceMilestone: true, isUnlimitedSteps: true }
const CAPPED: LoopBlockContext = { canAdvanceMilestone: true, isUnlimitedSteps: false }

/** Blocks `count` failing repeats and returns the escape chosen for each block. */
function failingBlocks(policy: AgentProgressPolicy, count: number, context: LoopBlockContext = UNLIMITED) {
  return Array.from({ length: count }, () => {
    const decision = policy.onLoopBlock('failing', context)
    return decision.kind === 'stagnation' ? decision.escape : decision.kind
  })
}

describe('AgentProgressPolicy loop blocks', () => {
  it('answers the first block with advice and escalates once advice has failed twice', () => {
    expect(failingBlocks(new AgentProgressPolicy(), 2)).toEqual(['advise', 'force_milestone_advance'])
  })

  it('leaves one advisory turn between consecutive structural escapes', () => {
    expect(failingBlocks(new AgentProgressPolicy(), 5)).toEqual(['advise', 'force_milestone_advance', 'advise', 'force_milestone_advance', 'advise'])
  })

  it('falls back to advice when the plan has nothing left to advance to', () => {
    const escapes = failingBlocks(new AgentProgressPolicy(), 4, { canAdvanceMilestone: false, isUnlimitedSteps: true })
    expect(escapes).toEqual(['advise', 'advise', 'advise', 'advise'])
  })

  it('aborts a run without step budget once the abort threshold is reached', () => {
    const escapes = failingBlocks(new AgentProgressPolicy(), PROGRESS_BUDGET.abortLoopBlocks + 1)
    expect(escapes.slice(-2)).toEqual(['abort', 'abort'])
    expect(escapes.slice(0, -2)).not.toContain('abort')
  })

  it('never aborts a step-capped run, which ends on its own step budget', () => {
    const escapes = failingBlocks(new AgentProgressPolicy(), PROGRESS_BUDGET.abortLoopBlocks, CAPPED)
    expect(escapes).not.toContain('abort')
    expect(escapes.at(-1)).toBe('force_milestone_advance')
  })

  it('treats repeats of a successful action as redundancy until the advisory budget is spent', () => {
    const policy = new AgentProgressPolicy()
    for (let block = 1; block <= PROGRESS_BUDGET.redundantSuccessBlocks; block++) {
      expect(policy.onLoopBlock('succeeding', UNLIMITED)).toEqual({ kind: 'redundant', redundantBlocks: block })
    }
    expect(policy.consecutiveLoopBlocks).toBe(0)
    expect(policy.onLoopBlock('succeeding', UNLIMITED)).toEqual({ kind: 'stagnation', loopBlocks: 1, escape: 'advise' })
  })

  it('restarts the redundancy streak as soon as the repeated action fails', () => {
    const policy = new AgentProgressPolicy()
    policy.onLoopBlock('succeeding', UNLIMITED)
    expect(policy.onLoopBlock('failing', UNLIMITED)).toMatchObject({ kind: 'stagnation', loopBlocks: 1 })
    expect(policy.onLoopBlock('succeeding', UNLIMITED)).toEqual({ kind: 'redundant', redundantBlocks: 1 })
  })

  it('starts loop and redundancy streaks over after an accepted call', () => {
    const policy = new AgentProgressPolicy()
    failingBlocks(policy, 3)
    policy.onCallAccepted()
    expect(policy.consecutiveLoopBlocks).toBe(0)
    expect(failingBlocks(policy, 1)).toEqual(['advise'])
  })
})

describe('AgentProgressPolicy ask redirects', () => {
  it('shares the loop-block count, so a model stuck in a loop cannot ask its way out', () => {
    const policy = new AgentProgressPolicy()
    failingBlocks(policy, 1)
    expect(policy.tryAskRedirect()).toBe(true)
    expect(policy.tryAskRedirect()).toBe(false)
    expect(policy.askRedirectsExhausted()).toBe(true)
  })
})

describe('AgentProgressPolicy prose and schema budgets', () => {
  it('grants two prose-only retries and restarts after a parsed tool call', () => {
    const policy = new AgentProgressPolicy()
    expect([policy.tryProseRetry(), policy.tryProseRetry(), policy.tryProseRetry()]).toEqual([true, true, false])
    policy.onToolCallParsed()
    expect(policy.tryProseRetry()).toBe(true)
  })

  it('allows one schema correction, then stops; a parsed call restores the budget', () => {
    const policy = new AgentProgressPolicy()
    expect(policy.onSchemaRejection('write_file:missing content').action).toBe('correct')
    expect(policy.onSchemaRejection('write_file:missing content').action).toBe('stop')
    expect(policy.schemaRejections).toBe(2)
    policy.onToolCallParsed()
    expect(policy.schemaRejections).toBe(0)
    expect(policy.onSchemaRejection('write_file:missing content').action).toBe('correct')
  })

  it('reports why the run stopped and reassures about the work already on disk', () => {
    const summary = schemaStopSummary('replace_file_content', 2)
    expect(summary).toContain('replace_file_content')
    expect(summary).toContain('2')
    expect(summary).toContain('restano sul disco')
  })
})

describe('AgentProgressPolicy execution budget and steps without mutation', () => {
  it('allows one execution correction, then stops, and restarts after proven recovery', () => {
    const policy = new AgentProgressPolicy()
    expect(policy.onExecutionFailure('read_file:a:missing').action).toBe('correct')
    policy.clearExecutionFailures()
    expect(policy.onExecutionFailure('read_file:a:missing').action).toBe('correct')
    expect(policy.onExecutionFailure('read_file:b:missing').action).toBe('stop')
    expect(policy.executionFailuresSpent).toBe(2)
  })

  it('restores the persisted failure budgets on resume', () => {
    const first = new AgentProgressPolicy()
    first.onExecutionFailure('run_command:npm test:exit 1')
    const resumed = new AgentProgressPolicy(first.snapshot())
    expect(resumed.onExecutionFailure('run_command:npm test:exit 1').action).toBe('stop')
  })

  it('stops after the configured number of executed steps without an effective change', () => {
    const policy = new AgentProgressPolicy()
    for (let step = 1; step < PROGRESS_BUDGET.stepsWithoutMutation; step++) expect(policy.onStepExecuted(false)).toBeNull()
    expect(policy.onStepExecuted(false)).toMatchObject({ guard: 'no_mutation', reason: expect.stringContaining('No-mutation stagnation streak') })
  })

  it('restarts the no-mutation count on an effective change', () => {
    const policy = new AgentProgressPolicy(undefined, { ...PROGRESS_BUDGET, stepsWithoutMutation: 3 })
    policy.onStepExecuted(false)
    policy.onStepExecuted(false)
    policy.onStepExecuted(true)
    expect(policy.onStepExecuted(false)).toBeNull()
  })
})
