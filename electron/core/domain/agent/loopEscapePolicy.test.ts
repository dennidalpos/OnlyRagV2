import { describe, expect, it } from 'vitest'
import {
  LOOP_ESCAPE_ABORT_STREAK,
  resolveLoopEscapeAction,
  type LoopEscapeContext,
} from './loopEscapePolicy'

const UNLIMITED: LoopEscapeContext = { canAdvanceMilestone: true, isUnlimitedSteps: true }
const CAPPED: LoopEscapeContext = { canAdvanceMilestone: true, isUnlimitedSteps: false }

describe('resolveLoopEscapeAction', () => {
  it('answers the first blocks with advisory text only', () => {
    expect(resolveLoopEscapeAction(0, UNLIMITED)).toBe('advise')
    expect(resolveLoopEscapeAction(1, UNLIMITED)).toBe('advise')
  })

  it('escalates to a structural escape once advisory text has failed twice', () => {
    expect(resolveLoopEscapeAction(2, UNLIMITED)).toBe('force_milestone_advance')
  })

  it('leaves one advisory turn between consecutive structural escapes', () => {
    expect(resolveLoopEscapeAction(3, UNLIMITED)).toBe('advise')
    expect(resolveLoopEscapeAction(4, UNLIMITED)).toBe('force_milestone_advance')
    expect(resolveLoopEscapeAction(5, UNLIMITED)).toBe('advise')
  })

  it('falls back to advisory text when the plan has nothing left to advance to', () => {
    expect(resolveLoopEscapeAction(4, { canAdvanceMilestone: false, isUnlimitedSteps: true })).toBe('advise')
  })

  it('aborts an unlimited-step session once the abort streak is reached', () => {
    expect(resolveLoopEscapeAction(LOOP_ESCAPE_ABORT_STREAK, UNLIMITED)).toBe('abort')
    expect(resolveLoopEscapeAction(LOOP_ESCAPE_ABORT_STREAK + 1, UNLIMITED)).toBe('abort')
  })

  it('never aborts a step-capped session, which ends on its own step budget', () => {
    expect(resolveLoopEscapeAction(LOOP_ESCAPE_ABORT_STREAK, CAPPED)).toBe('force_milestone_advance')
  })
})
