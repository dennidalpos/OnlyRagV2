export interface RetryPolicy {
  /** Delay before the first retry, in milliseconds. */
  baseDelayMs: number
  /** Upper bound the delay never exceeds, however long the outage lasts. */
  maxDelayMs: number
  /** Multiplier applied per consecutive failure. */
  factor: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 3000,
  maxDelayMs: 60000,
  factor: 2,
}

/**
 * Delay to wait before the attempt that follows `consecutiveFailures` failures.
 * Grows exponentially from `baseDelayMs` and saturates at `maxDelayMs`.
 */
export function nextRetryDelayMs(consecutiveFailures: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const failures = Math.max(1, Math.floor(consecutiveFailures))
  const growth = Math.pow(policy.factor, failures - 1)
  const delay = policy.baseDelayMs * growth
  if (!Number.isFinite(delay)) return policy.maxDelayMs
  return Math.min(delay, policy.maxDelayMs)
}

/** Whether the failure numbered `consecutiveFailures` deserves a log line. */
export function shouldReportFailure(consecutiveFailures: number): boolean {
  const failures = Math.floor(consecutiveFailures)
  if (failures < 1) return false
  return (failures & (failures - 1)) === 0
}
