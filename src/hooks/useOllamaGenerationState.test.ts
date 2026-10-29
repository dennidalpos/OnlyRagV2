import { describe, expect, it } from 'vitest'
import { resolveOllamaOperationState } from './useOllamaGenerationState'

describe('resolveOllamaOperationState', () => {
  const status = {
    active: { id: 'active-id', label: 'stream' },
    queued: [{ id: 'queued-id', label: 'stream' }],
    operations: [
      { id: 'active-id', label: 'stream', state: 'running' as const },
      { id: 'queued-id', label: 'stream', state: 'queued' as const },
      { id: 'cancelling-id', label: 'structured', state: 'cancelling' as const },
      { id: 'failed-id', label: 'structured', state: 'failed' as const },
    ],
  }

  it('distinguishes the active stream from a queued stream', () => {
    expect(resolveOllamaOperationState(status, 'active-id')).toBe('running')
    expect(resolveOllamaOperationState(status, 'queued-id')).toBe('queued')
  })

  it('ignores unrelated operations', () => {
    expect(resolveOllamaOperationState(status, 'other-id')).toBeNull()
  })

  it('returns terminal scheduler states for the tracked operation', () => {
    expect(resolveOllamaOperationState(status, 'cancelling-id')).toBe('cancelling')
    expect(resolveOllamaOperationState(status, 'failed-id')).toBe('failed')
  })
})
