import { describe, expect, it } from 'vitest'
import { resolveOllamaOperationState } from './useOllamaGenerationState'

describe('resolveOllamaOperationState', () => {
  const status = {
    active: { id: 'active-id', label: 'stream' },
    queued: [{ id: 'queued-id', label: 'stream' }],
  }

  it('distinguishes the active stream from a queued stream', () => {
    expect(resolveOllamaOperationState(status, 'active-id')).toBe('running')
    expect(resolveOllamaOperationState(status, 'queued-id')).toBe('queued')
  })

  it('ignores unrelated operations', () => {
    expect(resolveOllamaOperationState(status, 'other-id')).toBeNull()
  })
})
