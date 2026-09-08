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

export const MAX_FAILURES_PER_RECOVERY_CATEGORY = 2

/** Allows one corrective attempt, then stops the category deterministically. */
export function recordRecoveryFailure(
  previous: RecoveryFailureState | undefined,
  signature: string,
): RecoveryDecision {
  const equivalentFailures = previous?.signature === signature
    ? previous.equivalentFailures + 1
    : 1
  const totalFailures = (previous?.totalFailures || 0) + 1
  const state = { signature, equivalentFailures, totalFailures }

  if (equivalentFailures >= MAX_FAILURES_PER_RECOVERY_CATEGORY) {
    return { action: 'stop', state, reason: 'equivalent_failure' }
  }
  if (totalFailures >= MAX_FAILURES_PER_RECOVERY_CATEGORY) {
    return { action: 'stop', state, reason: 'category_budget' }
  }
  return { action: 'correct', state }
}

export function recoveryStopDiagnostic(category: RecoveryCategory, state: RecoveryFailureState): string {
  const reason = state.equivalentFailures >= MAX_FAILURES_PER_RECOVERY_CATEGORY
    ? 'the same failure recurred after its corrective attempt'
    : 'the category recovery budget was exhausted'
  return `${category} recovery stopped after ${state.totalFailures}/${MAX_FAILURES_PER_RECOVERY_CATEGORY} failures: ${reason}. Last signature: ${state.signature}`
}
