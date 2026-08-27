export type HttpErrorType = 'none' | 'http' | 'timeout' | 'network' | 'parse' | 'unknown'

export interface HttpMetricSnapshot {
  endpoint: string
  status: number
  errorType: HttpErrorType
  count: number
  totalDurationMs: number
  maxDurationMs: number
}

const MAX_ENDPOINTS = 32

/** In-process HTTP counters with bounded labels and no URL, query or local path values. */
export class HttpMetricsRegistry {
  private readonly counters = new Map<string, HttpMetricSnapshot>()

  record(endpoint: string, status: number, errorType: HttpErrorType, durationMs: number): void {
    const safeEndpoint = endpoint.startsWith('/') && !endpoint.includes('?') ? endpoint : '/unknown'
    const safeStatus = Number.isInteger(status) && status >= 0 && status <= 999 ? status : 0
    const key = `${safeEndpoint}|${safeStatus}|${errorType}`
    const existing = this.counters.get(key)
    if (existing) {
      existing.count += 1
      existing.totalDurationMs += durationMs
      existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs)
      return
    }
    if (this.counters.size >= MAX_ENDPOINTS) return
    this.counters.set(key, {
      endpoint: safeEndpoint,
      status: safeStatus,
      errorType,
      count: 1,
      totalDurationMs: durationMs,
      maxDurationMs: durationMs,
    })
  }

  snapshot(): HttpMetricSnapshot[] {
    return [...this.counters.values()].map((metric) => ({ ...metric }))
  }

  reset(): void {
    this.counters.clear()
  }
}

export const httpMetrics = new HttpMetricsRegistry()
