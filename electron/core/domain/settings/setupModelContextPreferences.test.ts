import { describe, expect, it } from 'vitest'
import { buildSetupModelContextPreferences } from '../../../../shared/domain/settings/setupModelContextPreferences'

describe('buildSetupModelContextPreferences', () => {
  it('stores the hardware-safe window once for each selected generative model', () => {
    expect(buildSetupModelContextPreferences(['qwen3:4b', 'qwen3:4b', 'gemma3:4b', '', undefined], undefined, 32768)).toEqual({
      'qwen3:4b': 32768,
      'gemma3:4b': 32768,
    })
  })

  it('preserves an explicit per-model preference when setup is reopened', () => {
    expect(buildSetupModelContextPreferences(['qwen3:4b', 'gemma3:4b'], { 'qwen3:4b': 8192 }, 32768)).toEqual({ 'qwen3:4b': 8192, 'gemma3:4b': 32768 })
  })
})
