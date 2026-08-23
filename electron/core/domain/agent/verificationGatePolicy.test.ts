import { describe, it, expect } from 'vitest'
import {
  MAX_VERIFICATION_FIX_CYCLES,
  decideVerificationGate,
  type VerificationGateInput,
} from './verificationGatePolicy'

function input(overrides: Partial<VerificationGateInput> = {}): VerificationGateInput {
  return { hasVerificationCommand: true, passed: false, cyclesSpent: 0, ...overrides }
}

describe('decideVerificationGate', () => {
  it('lets finish through as soon as the verification passes', () => {
    expect(decideVerificationGate(input({ passed: true }))).toEqual({ action: 'allow_finish' })
  })

  it('lets a passing verification through even on the last round', () => {
    expect(decideVerificationGate(input({ passed: true, cyclesSpent: 99 }))).toEqual({ action: 'allow_finish' })
  })

  it('blocks and hands the failure back on the first failed round', () => {
    const decision = decideVerificationGate(input({ failureDetail: 'error TS2307: Cannot find module' }))
    expect(decision.action).toBe('block_and_retry')
    if (decision.action !== 'block_and_retry') return
    expect(decision.cyclesSpent).toBe(1)
    expect(decision.directive).toContain('error TS2307')
    expect(decision.directive).toMatch(/forbidden from calling "finish"/i)
    expect(decision.directive).toContain(`round 1 of ${MAX_VERIFICATION_FIX_CYCLES}`)
  })

  it('keeps blocking while rounds remain', () => {
    expect(decideVerificationGate(input({ cyclesSpent: 1 })).action).toBe('block_and_retry')
  })

  it('closes the session as FAILED once the rounds are exhausted', () => {
    const decision = decideVerificationGate(input({ cyclesSpent: MAX_VERIFICATION_FIX_CYCLES - 1, failureDetail: 'boom' }))
    expect(decision.action).toBe('fail_session')
    if (decision.action !== 'fail_session') return
    expect(decision.summary).toContain('FAILED')
    expect(decision.summary).toContain('boom')
  })

  it('never reports success for a session it gave up on', () => {
    // The o3tx regression: three abandoned milestones, no build ever run, status COMPLETED.
    const decision = decideVerificationGate(input({ cyclesSpent: 10 }))
    expect(decision.action).toBe('fail_session')
  })

  it('proceeds, saying so, when the project offers nothing that could verify it', () => {
    const decision = decideVerificationGate(input({ hasVerificationCommand: false, passed: undefined }))
    expect(decision.action).toBe('allow_finish_unverified')
    if (decision.action !== 'allow_finish_unverified') return
    expect(decision.warning).toMatch(/has NOT been proven/i)
  })

  it('does not blame the model for a missing verification command', () => {
    const decision = decideVerificationGate(input({ hasVerificationCommand: false, cyclesSpent: 2 }))
    // No command means no round was spent trying: this is not a correction failure.
    expect(decision.action).toBe('allow_finish_unverified')
  })

  it('still produces a usable directive when no output was captured', () => {
    const decision = decideVerificationGate(input({ failureDetail: '   ' }))
    expect(decision.action).toBe('block_and_retry')
    if (decision.action !== 'block_and_retry') return
    expect(decision.directive).toContain('(no output captured)')
  })
})
