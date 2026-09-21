import { describe, expect, it } from 'vitest'
import { DIAGNOSTICS_STARTUP_RETRY_MS, getDiagnosticsPollDelay } from './useDiagnostics'

describe('diagnostics polling policy', () => {
  it('retries quickly while the sidecar is starting or offline', () => {
    expect(getDiagnosticsPollDelay('checking', 10_000)).toBe(DIAGNOSTICS_STARTUP_RETRY_MS)
    expect(getDiagnosticsPollDelay('offline', 10_000)).toBe(DIAGNOSTICS_STARTUP_RETRY_MS)
    expect(getDiagnosticsPollDelay(undefined, 10_000)).toBe(DIAGNOSTICS_STARTUP_RETRY_MS)
  })

  it('uses the normal interval once the sidecar is online', () => {
    expect(getDiagnosticsPollDelay('online', 10_000)).toBe(10_000)
  })

  it('does not lengthen an explicitly shorter interval', () => {
    expect(getDiagnosticsPollDelay('offline', 250)).toBe(250)
  })
})
