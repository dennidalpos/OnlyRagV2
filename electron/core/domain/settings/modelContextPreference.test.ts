import { describe, expect, it } from 'vitest'
import { getModelContextChoices, resolveModelContextLength } from '../../../../shared/domain/settings/modelContextPreference'

describe('resolveModelContextLength', () => {
  it('uses the model preference without exceeding hardware or trained ceilings', () => {
    expect(resolveModelContextLength('model', { model: 8192 }, 32768, 16384)).toBe(8192)
    expect(resolveModelContextLength('model', { model: 32768 }, 32768, 8192)).toBe(8192)
  })

  it('keeps the minimum context floor when a bad preference is supplied', () => {
    expect(resolveModelContextLength('model', { model: 1024 }, 8192)).toBe(2048)
  })

  it('allows a manual value above the hardware default up to the model maximum', () => {
    expect(resolveModelContextLength('model', { model: 32768 }, 8192, 32768)).toBe(32768)
  })

  it('resets to the hardware default when the preference is absent', () => {
    expect(resolveModelContextLength('model', undefined, 16384, 32768)).toBe(16384)
  })

  it('keeps the hardware capacity when the model limit is unknown', () => {
    expect(resolveModelContextLength('custom-model', undefined, 16384)).toBe(16384)
  })

  it('exposes powers of two and the exact model maximum', () => {
    expect(getModelContextChoices(24576)).toEqual([2048, 4096, 8192, 16384, 24576])
  })

  it('honours a real 2K model context without raising it to the generic floor', () => {
    expect(resolveModelContextLength('small-model', undefined, 8192, 2048)).toBe(2048)
    expect(resolveModelContextLength('small-model', { 'small-model': 4096 }, 8192, 2048)).toBe(2048)
    expect(getModelContextChoices(2048)).toEqual([2048])
  })
})
