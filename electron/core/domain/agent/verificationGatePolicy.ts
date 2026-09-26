import { renderAdviceSteps } from './diagnosticAdvice'

/** Rounds of correct-and-re-verify allowed before the session is given up as failed. */
export const MAX_VERIFICATION_FIX_CYCLES = 3

export interface VerificationGateInput {
  /** Whether the project offers any command capable of proving it works. */
  hasVerificationCommand: boolean
  /** Outcome of the verification just performed. Undefined when none could be run. */
  passed?: boolean
  /** Human-readable failure detail: build output tail, or the dependency gate's directive. */
  failureDetail?: string
  /** Verification rounds already spent on this session, before the current one. */
  cyclesSpent: number
}

export type VerificationGateDecision =
  | { action: 'allow_finish' }
  | { action: 'allow_finish_unverified'; warning: string }
  | { action: 'block_and_retry'; directive: string; cyclesSpent: number }
  | { action: 'fail_session'; summary: string }

export function decideVerificationGate(input: VerificationGateInput): VerificationGateDecision {
  if (input.passed === true) return { action: 'allow_finish' }

  if (!input.hasVerificationCommand) {
    // Nothing in the project can prove or disprove it. Blocking here would deadlock a workspace
    // that legitimately has no build step, so the session proceeds — saying so out loud.
    return {
      action: 'allow_finish_unverified',
      warning:
        'No verification command could be resolved from this project (no build, typecheck, test or lint script, and no tsconfig.json). ' +
        'The result has NOT been proven to work and the final report must say so.',
    }
  }

  const cyclesSpent = input.cyclesSpent + 1
  const detail = (input.failureDetail || '').trim()

  if (cyclesSpent >= MAX_VERIFICATION_FIX_CYCLES) {
    return {
      action: 'fail_session',
      summary:
        `Verification still failing after ${cyclesSpent} correction rounds. The session is closed as FAILED: ` +
        'the work on disk has not been proven to build or run.\n\n' +
        `Last failure:\n${detail || '(no output captured)'}`,
    }
  }

  return {
    action: 'block_and_retry',
    cyclesSpent,
    directive: renderAdviceSteps(
      '[DEFINITION OF DONE VIOLATION: VERIFICATION FAILED]',
      [
        `The verification of this project does not pass (round ${cyclesSpent} of ${MAX_VERIFICATION_FIX_CYCLES}), so "finish" was refused.`,
        detail || '(no output captured)',
        `After ${MAX_VERIFICATION_FIX_CYCLES} failed rounds the session is closed as FAILED.`,
      ],
      [
        'Read the failure above and fix its ROOT CAUSE in the source files; the same command rerun unchanged fails the same way.',
        'Fix one cause at a time, then verify again.',
        'Deleting or emptying files to make the error disappear is not a fix.',
      ],
    ),
  }
}
