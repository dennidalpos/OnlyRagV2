import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RETRY_POLICY,
  nextRetryDelayMs,
  shouldReportFailure,
  RetryPolicy,
} from './pollingRetryPolicy'

describe('pollingRetryPolicy — backoff', () => {
  it('starts at the base delay and doubles per consecutive failure', () => {
    expect(nextRetryDelayMs(1)).toBe(3000)
    expect(nextRetryDelayMs(2)).toBe(6000)
    expect(nextRetryDelayMs(3)).toBe(12000)
    expect(nextRetryDelayMs(4)).toBe(24000)
    expect(nextRetryDelayMs(5)).toBe(48000)
  })

  it('saturates at maxDelayMs instead of growing without bound', () => {
    expect(nextRetryDelayMs(6)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs)
    expect(nextRetryDelayMs(50)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs)
    expect(nextRetryDelayMs(5000)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs)
  })

  it('treats a zero or negative failure count as the first failure', () => {
    expect(nextRetryDelayMs(0)).toBe(3000)
    expect(nextRetryDelayMs(-4)).toBe(3000)
  })

  it('honours a custom policy', () => {
    const policy: RetryPolicy = { baseDelayMs: 500, maxDelayMs: 2000, factor: 3 }
    expect(nextRetryDelayMs(1, policy)).toBe(500)
    expect(nextRetryDelayMs(2, policy)).toBe(1500)
    expect(nextRetryDelayMs(3, policy)).toBe(2000)
  })

  it('caps rather than overflowing to Infinity on an absurd failure count', () => {
    expect(nextRetryDelayMs(Number.MAX_SAFE_INTEGER)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs)
  })
})

describe('pollingRetryPolicy — log throttling', () => {
  it('reports the first failure of an outage', () => {
    expect(shouldReportFailure(1)).toBe(true)
  })

  it('stays silent on the attempts between powers of two', () => {
    expect(shouldReportFailure(3)).toBe(false)
    expect(shouldReportFailure(5)).toBe(false)
    expect(shouldReportFailure(6)).toBe(false)
    expect(shouldReportFailure(7)).toBe(false)
    expect(shouldReportFailure(29)).toBe(false)
  })

  it('reports again on each power of two so a long outage stays visible', () => {
    expect(shouldReportFailure(2)).toBe(true)
    expect(shouldReportFailure(4)).toBe(true)
    expect(shouldReportFailure(8)).toBe(true)
    expect(shouldReportFailure(16)).toBe(true)
    expect(shouldReportFailure(1024)).toBe(true)
  })

  it('never reports outside of an outage', () => {
    expect(shouldReportFailure(0)).toBe(false)
    expect(shouldReportFailure(-1)).toBe(false)
  })

  it('keeps the log cost logarithmic: the 29 attempts seen in app.log collapse to 5 lines', () => {
    const reported = Array.from({ length: 29 }, (_, i) => i + 1).filter(shouldReportFailure)
    expect(reported).toEqual([1, 2, 4, 8, 16])
  })
})
