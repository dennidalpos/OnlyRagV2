/**
 * Pure retry policy shared by renderer pollers that bridge a backend still coming up.
 *
 * Kept free of React and DOM so the escalation rules can be tested directly: a fixed-interval
 * retry that logs on every attempt turns a backend outage into thousands of identical log lines
 * and IPC round-trips, which is exactly what the log file must not become.
 */

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
export function nextRetryDelayMs(
  consecutiveFailures: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): number {
  const failures = Math.max(1, Math.floor(consecutiveFailures))
  const growth = Math.pow(policy.factor, failures - 1)
  const delay = policy.baseDelayMs * growth
  if (!Number.isFinite(delay)) return policy.maxDelayMs
  return Math.min(delay, policy.maxDelayMs)
}

/**
 * Whether the failure numbered `consecutiveFailures` deserves a log line.
 *
 * True on the first failure and then only on powers of two, so a persistent outage costs a
 * logarithmic number of lines instead of one per attempt, while still leaving a trace that the
 * outage is ongoing and how many attempts it has cost.
 */
export function shouldReportFailure(consecutiveFailures: number): boolean {
  const failures = Math.floor(consecutiveFailures)
  if (failures < 1) return false
  return (failures & (failures - 1)) === 0
}
