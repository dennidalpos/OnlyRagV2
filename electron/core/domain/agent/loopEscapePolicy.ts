/**
 * Loop Escape Policy.
 *
 * The loop guard used to answer every repeated tool call the same way: send the model a
 * sterner paragraph of text and re-issue an otherwise identical prompt. A model that cannot
 * act on that paragraph therefore re-emits the same tool call, and the guard re-sends the
 * same paragraph — 20 times in a row in coding_agent_audit.log session-1787445915590-u395,
 * because the ACTIVE MILESTONE line kept demanding exactly the action being blocked.
 *
 * Advisory text is still the first response: a model capable of self-correcting deserves the
 * chance. What changes is what happens when that advice demonstrably fails — the session then
 * alters its own state (the active milestone moves on) so the next prompt asks for something
 * genuinely different. Escalation is paced so every structural escape is followed by one
 * advisory turn, giving the model a clean attempt at the new milestone before moving again.
 */

export type LoopEscapeAction = 'advise' | 'force_milestone_advance' | 'abort'

/** Consecutive blocks tolerated on advisory text alone before the session changes its own state. */
export const LOOP_ESCAPE_ADVISORY_ATTEMPTS = 2

/** Consecutive blocks after which an unlimited-step session gives up rather than burn hardware. */
export const LOOP_ESCAPE_ABORT_STREAK = 20

export interface LoopEscapeContext {
  /** True when the plan still holds a non-verified milestone the focus could move to. */
  canAdvanceMilestone: boolean
  /** Step-capped sessions terminate on their own step budget and never abort early here. */
  isUnlimitedSteps: boolean
}

/**
 * Maps the current consecutive-block streak onto the response the guard should take.
 * `stagnationStreak` is the shared "how stuck is the model right now" counter, reset to 0
 * by any successfully executed tool — so a streak of N means N advisories in a row failed.
 */
export type RedundantSuccessAction = 'advise' | 'treat_as_stagnation'

/**
 * Advisory turns granted to a model that keeps re-issuing a command which SUCCEEDS every time.
 * Kept low: the advice is cheap, but the model still has to move on eventually.
 */
export const REDUNDANT_SUCCESS_ADVISORY_ATTEMPTS = 3

/**
 * Repeating a successful command is not stagnation — the deliverable exists and the milestone
 * is achievable, so escalating it would mark work FAILED that actually happened (audit session
 * o3tx: `npm install` succeeded at steps 12 and 13, yet milestone m-12 was abandoned as FAILED
 * on the third attempt and reported as incomplete).
 *
 * The exemption is bounded rather than unconditional: it suppresses the escalation ladder, and
 * the ladder is the only thing that terminates a session which never breaks out. After
 * REDUNDANT_SUCCESS_ADVISORY_ATTEMPTS advisories the repeat rejoins the normal stagnation path,
 * so the abort guarantee still holds — it is deferred, never removed.
 */
export function resolveRedundantSuccessAction(redundantSuccessStreak: number): RedundantSuccessAction {
  return redundantSuccessStreak > REDUNDANT_SUCCESS_ADVISORY_ATTEMPTS ? 'treat_as_stagnation' : 'advise'
}

export function resolveLoopEscapeAction(stagnationStreak: number, ctx: LoopEscapeContext): LoopEscapeAction {
  if (ctx.isUnlimitedSteps && stagnationStreak >= LOOP_ESCAPE_ABORT_STREAK) return 'abort'

  const advisoryExhausted = stagnationStreak >= LOOP_ESCAPE_ADVISORY_ATTEMPTS
  // Alternating on parity leaves one advisory turn between structural escapes, so the model
  // gets an untouched attempt at the milestone it was just moved onto.
  const isEscalationTurn = stagnationStreak % 2 === 0

  if (advisoryExhausted && isEscalationTurn && ctx.canAdvanceMilestone) return 'force_milestone_advance'

  return 'advise'
}
