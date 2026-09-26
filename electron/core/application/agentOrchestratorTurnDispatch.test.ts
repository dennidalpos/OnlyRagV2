import { describe, expect, it } from 'vitest'
import { streamStallTimeoutMs } from './agentOrchestratorTurnDispatch'

describe('streamStallTimeoutMs', () => {
  it('waits 10 minutes before the model speed is known', () => {
    expect(streamStallTimeoutMs(undefined)).toBe(10 * 60 * 1000)
    expect(streamStallTimeoutMs([{ completionTokens: 5, evalDurationMs: 1000 }])).toBe(10 * 60 * 1000)
  })

  it('gives a slow model time to finish a large tool call that Ollama does not stream', () => {
    // qwen3-coder:30b on the 2026-09-26 live run: 3.95 tokens/s, killed twice by the fixed 5-minute limit.
    const slow = streamStallTimeoutMs([{ completionTokens: 1193, evalDurationMs: 302_000 }])
    expect(slow).toBeGreaterThan(15 * 60 * 1000)
    expect(slow).toBeLessThanOrEqual(30 * 60 * 1000)
  })

  it('keeps the 5-minute floor for fast models and caps very slow ones at 30 minutes', () => {
    expect(streamStallTimeoutMs([{ completionTokens: 400, evalDurationMs: 10_000 }])).toBe(5 * 60 * 1000)
    expect(streamStallTimeoutMs([{ completionTokens: 100, evalDurationMs: 200_000 }])).toBe(30 * 60 * 1000)
  })

  it('uses the most recent measurement', () => {
    const telemetry = [
      { completionTokens: 400, evalDurationMs: 10_000 },
      { completionTokens: 400, evalDurationMs: 200_000 },
    ]
    expect(streamStallTimeoutMs(telemetry)).toBeGreaterThan(5 * 60 * 1000)
  })
})
