export type RecoveryCategory = 'transport' | 'schema' | 'execution'

export interface RecoveryFailureState {
  signature: string
  equivalentFailures: number
  totalFailures: number
}

export interface RecoveryDecision {
  action: 'correct' | 'stop'
  state: RecoveryFailureState
  reason?: 'equivalent_failure' | 'category_budget'
}

/** Transport and schema failures: one corrective attempt, then stop. */
export const MAX_FAILURES_PER_RECOVERY_CATEGORY = 2

export interface RecoveryLimits {
  /** Identical failures (same signature) in a row that stop the category. */
  equivalent: number
  /** Consecutive failures of any kind that stop the category. */
  total: number
}

const DEFAULT_LIMITS: RecoveryLimits = { equivalent: MAX_FAILURES_PER_RECOVERY_CATEGORY, total: MAX_FAILURES_PER_RECOVERY_CATEGORY }

/**
 * Tool execution failures are the model's ground truth: a failed build followed by a mistargeted
 * replace is ordinary debugging, not a reason to stop. Two failures in a row made execution_budget
 * the most common stop of the 2026-09 live runs; the run now stops on the third identical failure
 * or the sixth in a row, and any successful mutation or command starts the count over.
 */
export const EXECUTION_RECOVERY_LIMITS: RecoveryLimits = { equivalent: 3, total: 6 }

/** Records one failure and decides whether the category may still correct itself. */
export function recordRecoveryFailure(
  previous: RecoveryFailureState | undefined,
  signature: string,
  limits: RecoveryLimits = DEFAULT_LIMITS,
): RecoveryDecision {
  const equivalentFailures = previous?.signature === signature ? previous.equivalentFailures + 1 : 1
  const totalFailures = (previous?.totalFailures || 0) + 1
  const state = { signature, equivalentFailures, totalFailures }

  if (equivalentFailures >= limits.equivalent) {
    return { action: 'stop', state, reason: 'equivalent_failure' }
  }
  if (totalFailures >= limits.total) {
    return { action: 'stop', state, reason: 'category_budget' }
  }
  return { action: 'correct', state }
}

export function recoveryStopDiagnostic(category: RecoveryCategory, state: RecoveryFailureState, limits: RecoveryLimits = DEFAULT_LIMITS): string {
  const reason = state.equivalentFailures >= limits.equivalent ? 'the same failure kept recurring' : 'the category recovery budget was exhausted'
  return `${category} recovery stopped after ${state.totalFailures}/${limits.total} failures: ${reason}. Last signature: ${state.signature}`
}
