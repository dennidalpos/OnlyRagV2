import { describe, expect, it } from 'vitest'
import { HttpMetricsRegistry } from './httpMetrics'

describe('HttpMetricsRegistry', () => {
  it('aggregates bounded endpoint/status/error labels and durations', () => {
    const registry = new HttpMetricsRegistry()
    registry.record('/api/tags', 200, 'none', 12)
    registry.record('/api/tags', 200, 'none', 8)
    registry.record('/api/tags', 500, 'http', 20)

    expect(registry.snapshot()).toEqual([
      { endpoint: '/api/tags', status: 200, errorType: 'none', count: 2, totalDurationMs: 20, maxDurationMs: 12 },
      { endpoint: '/api/tags', status: 500, errorType: 'http', count: 1, totalDurationMs: 20, maxDurationMs: 20 },
    ])
  })

  it('rejects query-bearing labels and caps cardinality', () => {
    const registry = new HttpMetricsRegistry()
    registry.record('/api/tags?model=secret', 200, 'none', 1)
    for (let i = 0; i < 40; i += 1) registry.record(`/endpoint-${i}`, 200, 'none', 1)

    expect(registry.snapshot()[0].endpoint).toBe('/unknown')
    expect(registry.snapshot().length).toBe(32)
  })
})
