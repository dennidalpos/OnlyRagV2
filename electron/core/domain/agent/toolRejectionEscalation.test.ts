import { describe, it, expect } from 'vitest'
import {
  REJECTION_ABORT_STREAK,
  REJECTION_CORRECTION_ATTEMPTS,
  buildToolSwitchDirective,
  rejectionAbortSummary,
  resolveToolRejectionAction,
} from './toolRejectionEscalation'

/**
 * The path this ladder was written for had no ladder and no terminating guarantee. Live run of
 * 2026-08-24: steps 18 through 50, thirty-three consecutive `replace_file_content` calls
 * rejected for a missing `replacementContent`, ZERO `LOOP INTERVENTION PREVENTED` entries in
 * the whole audit log — validation refuses these calls before the loop detector can see them —
 * and a session that ended only because it ran out of steps.
 */
describe('resolveToolRejectionAction', () => {
  it('answers the first rejections with the contract, as before', () => {
    expect(resolveToolRejectionAction(1)).toBe('correct')
    expect(resolveToolRejectionAction(REJECTION_CORRECTION_ATTEMPTS)).toBe('correct')
  })

  it('changes the instruction once repeating the contract has failed', () => {
    // The contract is correct and was sent 97 times in that run. A 98th copy is not an answer.
    expect(resolveToolRejectionAction(REJECTION_CORRECTION_ATTEMPTS + 1)).toBe('switch_tool')
  })

  it('stops the session rather than spending the remaining budget', () => {
    expect(resolveToolRejectionAction(REJECTION_ABORT_STREAK)).toBe('abort')
    expect(resolveToolRejectionAction(REJECTION_ABORT_STREAK + 10)).toBe('abort')
  })

  it('aborts well before the thirty-three steps that were actually observed', () => {
    expect(REJECTION_ABORT_STREAK).toBeLessThan(33)
  })

  it('leaves room for the switch directive to be tried before giving up', () => {
    expect(REJECTION_ABORT_STREAK).toBeGreaterThan(REJECTION_CORRECTION_ATTEMPTS + 1)
  })
})

describe('buildToolSwitchDirective', () => {
  it('names one tool and forbids the one being rejected', () => {
    const directive = buildToolSwitchDirective('replace_file_content', 3)

    expect(directive).toContain('Your next tool call MUST be "write_file"')
    expect(directive).toContain('Do NOT emit "replace_file_content" again')
  })

  it('says why the alternative works, so the choice is not arbitrary', () => {
    // A model told only "do something else" picks anything. The reason is the exact-match
    // parameter it has demonstrably failed to produce.
    expect(buildToolSwitchDirective('replace_file_content', 3)).toContain('needs no exact-match parameter')
  })

  it('states that nothing was written, which is the fact the model is missing', () => {
    const directive = buildToolSwitchDirective('multi_replace_file_content', 5)

    expect(directive).toContain('nothing you intended has been written')
    expect(directive).toContain('5 TIMES IN A ROW')
  })

  it('does not repeat the schema it is replacing', () => {
    const directive = buildToolSwitchDirective('replace_file_content', 4)

    // One message, one instruction: re-printing the contract here would restore the very
    // competition this directive exists to end.
    expect(directive).not.toContain('Mandatory parameters')
    expect(directive).not.toContain('targetContent')
  })
})

describe('rejectionAbortSummary', () => {
  it('reports the real reason and reassures about the work already on disk', () => {
    const summary = rejectionAbortSummary('replace_file_content', 8)

    expect(summary).toContain('replace_file_content')
    expect(summary).toContain('8')
    expect(summary).toContain('restano sul disco')
  })
})
