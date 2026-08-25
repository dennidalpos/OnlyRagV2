import { describe, it, expect } from 'vitest'
import {
  budgetExhaustionSummary,
  shouldVerifyOnBudgetExhaustion,
  type BudgetExhaustionVerificationInput,
} from './budgetExhaustionVerification'

/**
 * The state live-full-task ended in at 2026-08-25T12:16: the budget ran out with twelve files
 * on disk, nothing verified, and every milestone in the plan waiting on a check that no exit
 * path was going to run.
 */
function liveRunExit(overrides: Partial<BudgetExhaustionVerificationInput> = {}): BudgetExhaustionVerificationInput {
  return {
    budgetExhausted: true,
    sessionActive: true,
    hasWorkspace: true,
    verifyBeforeFinish: true,
    hasFileMutations: true,
    hasVerifiedBuild: false,
    promotableMilestoneCount: 14,
    ...overrides,
  }
}

describe('shouldVerifyOnBudgetExhaustion', () => {
  it('verifies the run that burned its whole budget with every deliverable on disk', () => {
    // The measured failure: 50/50 steps, 12 files, 0 verified, and promoteMilestonesProvenBy
    // never called once because nothing on this exit path calls it.
    expect(shouldVerifyOnBudgetExhaustion(liveRunExit())).toBe(true)
  })

  it('does nothing when the loop ended for any reason other than the budget', () => {
    // `finish`, an error and the circuit breaker all return before this point, and each has
    // already decided what the session proved. Re-verifying here would double-run the build.
    expect(shouldVerifyOnBudgetExhaustion(liveRunExit({ budgetExhausted: false }))).toBe(false)
  })

  it('starts no build on a session that is no longer live', () => {
    // cleanupSession has killed the shell and rolled back the journal; a command started now
    // would run against a workspace the session has already disowned.
    expect(shouldVerifyOnBudgetExhaustion(liveRunExit({ sessionActive: false }))).toBe(false)
  })

  it('does nothing without a workspace', () => {
    expect(shouldVerifyOnBudgetExhaustion(liveRunExit({ hasWorkspace: false }))).toBe(false)
  })

  it('honours verifyBeforeFinish, exactly as the finish gate does', () => {
    // One setting, one meaning: a user who turned verification off at `finish` did not ask for
    // it to reappear at the other exit.
    expect(shouldVerifyOnBudgetExhaustion(liveRunExit({ verifyBeforeFinish: false }))).toBe(false)
  })

  it('does nothing when the session wrote no file', () => {
    // Nothing on disk is nothing to prove, and the check would only report the workspace as it
    // was before the session started.
    expect(shouldVerifyOnBudgetExhaustion(liveRunExit({ hasFileMutations: false }))).toBe(false)
  })

  it('does not re-run a verification that already passed with nothing written since', () => {
    expect(shouldVerifyOnBudgetExhaustion(liveRunExit({ hasVerifiedBuild: true }))).toBe(false)
  })

  it('does not spend minutes on a build that could promote nothing', () => {
    // Both ends of the same case: a plan already fully verified, and a plan whose milestones
    // are all still missing their files. Neither has a milestone this check could close, and a
    // cold `npm run build` is too expensive to run for an outcome known in advance.
    expect(shouldVerifyOnBudgetExhaustion(liveRunExit({ promotableMilestoneCount: 0 }))).toBe(false)
  })
})

describe('budgetExhaustionSummary', () => {
  it('states what the final check proved when it passed', () => {
    const summary = budgetExhaustionSummary(50, { kind: 'passed', command: 'npm run build', promoted: 14 })
    expect(summary).toContain('50 step')
    expect(summary).toContain('npm run build')
    expect(summary).toContain('14 milestone')
  })

  it('says the project was not proven when the check failed', () => {
    const summary = budgetExhaustionSummary(50, { kind: 'failed', command: 'npm run build' })
    expect(summary).toContain('fallita')
    expect(summary).toContain('npm run build')
  })

  it('says so when the project offers no command able to prove it', () => {
    expect(budgetExhaustionSummary(50, { kind: 'no_command' })).toContain('Nessun comando di verifica')
  })

  it('keeps the plain budget message when no check was attempted', () => {
    expect(budgetExhaustionSummary(50, { kind: 'not_attempted' })).toBe(
      'Raggiunto il limite massimo di passaggi configurato (50 step).'
    )
  })
})
