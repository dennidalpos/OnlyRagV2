import { describe, expect, it } from 'vitest'
import { resolveModelContextLength } from './modelContextPreference'

describe('resolveModelContextLength', () => {
  it('uses the model preference without exceeding hardware or trained ceilings', () => {
    expect(resolveModelContextLength('model', { model: 8192 }, 32768, 16384)).toBe(8192)
    expect(resolveModelContextLength('model', { model: 32768 }, 32768, 8192)).toBe(8192)
  })

  it('keeps the minimum context floor when a bad preference is supplied', () => {
    expect(resolveModelContextLength('model', { model: 1024 }, 8192)).toBe(4096)
  })
})
