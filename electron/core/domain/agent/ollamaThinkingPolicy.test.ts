import { describe, expect, it } from 'vitest'
import { resolveOllamaThinkingMode, resolveOllamaThinkingPreference, updateModelThinkingPreference } from '../../../../shared/domain/agent/ollamaThinkingPolicy'

const metrics = {
  'qwen3:4b': { capabilities: ['completion', 'tools', 'thinking'], family: 'qwen3' },
  'gpt-oss:20b': { capabilities: ['completion', 'tools', 'thinking'], family: 'gpt-oss' },
  'custom-reasoner:latest': { capabilities: ['completion', 'thinking'], family: 'gptoss' },
  'llama3.2:latest': { capabilities: ['completion', 'tools'], family: 'llama' },
  'reasoner:latest': { capabilities: ['thinking'], family: 'reasoner' },
}

describe('ollamaThinkingPolicy', () => {
  it('enables only an installed binary-thinking model with an explicit preference', () => {
    expect(resolveOllamaThinkingPreference('qwen3:4b', { modelThinkingPreferences: {} }, metrics)).toMatchObject({
      mode: 'binary',
      enabled: false,
      think: false,
    })
    expect(
      resolveOllamaThinkingPreference(
        'qwen3:4b',
        {
          modelThinkingPreferences: { 'qwen3:4b': true },
        },
        metrics,
      ),
    ).toMatchObject({ mode: 'binary', enabled: true, think: true })
  })

  it('fails closed for level-only, unsupported, unknown, and inexact aliases', () => {
    const enabled = { modelThinkingPreferences: { 'gpt-oss:20b': true, 'llama3.2:latest': true, 'qwen3-vl:4b': true } }
    expect(resolveOllamaThinkingPreference('gpt-oss:20b', enabled, metrics)).toMatchObject({ mode: 'level-only', think: false })
    expect(resolveOllamaThinkingPreference('custom-reasoner', enabled, metrics)).toMatchObject({ mode: 'level-only', think: false })
    expect(resolveOllamaThinkingPreference('llama3.2', enabled, metrics)).toMatchObject({ mode: 'unsupported', think: false })
    expect(resolveOllamaThinkingPreference('qwen3-vl:4b', enabled, metrics)).toMatchObject({ mode: 'unknown', think: false })
    expect(resolveOllamaThinkingPreference('reasoner', enabled, metrics)).toMatchObject({ mode: 'unsupported', think: false })
  })

  it('reports model support and preserves preferences independently', () => {
    expect(resolveOllamaThinkingMode('qwen3:4b', metrics).installedModel).toBe('qwen3:4b')
    expect(updateModelThinkingPreference({ 'qwen3:4b': true }, 'qwen3-vl:4b', false)).toEqual({
      'qwen3:4b': true,
      'qwen3-vl:4b': false,
    })
  })
})
