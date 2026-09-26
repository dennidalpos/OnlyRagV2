import { describe, expect, it } from 'vitest'
import {
  resolveAgentThinkValue,
  resolveOllamaThinkingMode,
  resolveOllamaThinkingPreference,
  resolveStructuredThinkValue,
  updateModelThinkingPreference,
} from '../../../../shared/domain/agent/ollamaThinkingPolicy'

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

describe('resolveStructuredThinkValue', () => {
  it('gives level-only models their lowest level, since think:false leaves gpt-oss with empty JSON content', () => {
    expect(resolveStructuredThinkValue(resolveOllamaThinkingPreference('gpt-oss:20b', {}, metrics as never))).toBe('low')
  })

  it('keeps the boolean preference of every other model', () => {
    expect(resolveStructuredThinkValue(resolveOllamaThinkingPreference('qwen3:4b', { modelThinkingPreferences: { 'qwen3:4b': true } }, metrics as never))).toBe(
      true,
    )
    expect(resolveStructuredThinkValue(resolveOllamaThinkingPreference('llama3.2:latest', {}, metrics as never))).toBe(false)
  })
})

describe('thinking levels reported by /api/show', () => {
  const reported = {
    'qwen3.8:27b': {
      capabilities: ['completion', 'vision', 'tools', 'thinking'],
      family: 'qwen35',
      thinking: { values: [false, 'low', 'medium', 'xhigh'], default: 'medium' },
    },
    'gpt-oss:20b': { capabilities: ['completion', 'tools', 'thinking'], family: 'gptoss', thinking: { values: ['low', 'medium', 'high'], default: 'medium' } },
    'llama3.2:latest': { capabilities: ['completion', 'tools'], family: 'llama' },
  }

  it('classifies from the reported values, not from the model family', () => {
    expect(resolveOllamaThinkingMode('qwen3.8:27b', reported)).toMatchObject({ mode: 'binary', levels: ['low', 'medium', 'xhigh'], modelDefault: 'medium' })
    expect(resolveOllamaThinkingMode('gpt-oss:20b', reported)).toMatchObject({ mode: 'level-only', levels: ['low', 'medium', 'high'] })
  })

  it('omits think for the agent unless the user chose a value the model accepts', () => {
    expect(resolveAgentThinkValue('qwen3.8:27b', {}, reported)).toBeUndefined()
    expect(resolveAgentThinkValue('qwen3.8:27b', { modelThinkingPreferences: { 'qwen3.8:27b': 'low' } }, reported)).toBe('low')
    expect(resolveAgentThinkValue('qwen3.8:27b', { modelThinkingPreferences: { 'qwen3.8:27b': 'high' } }, reported)).toBeUndefined()
    expect(resolveAgentThinkValue('qwen3.8:27b', { modelThinkingPreferences: { 'qwen3.8:27b': false } }, reported)).toBe(false)
    expect(resolveAgentThinkValue('gpt-oss:20b', { modelThinkingPreferences: { 'gpt-oss:20b': false } }, reported)).toBe('low')
    expect(resolveAgentThinkValue('llama3.2:latest', { modelThinkingPreferences: { 'llama3.2:latest': true } }, reported)).toBeUndefined()
  })

  it('treats a chosen level as enabled for boolean-only features and removes a cleared preference', () => {
    expect(resolveOllamaThinkingPreference('qwen3.8:27b', { modelThinkingPreferences: { 'qwen3.8:27b': 'low' } }, reported).think).toBe(true)
    expect(resolveStructuredThinkValue(resolveOllamaThinkingPreference('gpt-oss:20b', {}, reported))).toBe('low')
    expect(updateModelThinkingPreference({ 'qwen3.8:27b': 'low' }, 'qwen3.8:27b', undefined)).toEqual({})
  })

  it('sends the chosen level to structured generation, not the model default', () => {
    const settings = (value: string | boolean) => ({ modelThinkingPreferences: { 'qwen3.8:27b': value } })
    expect(resolveStructuredThinkValue(resolveOllamaThinkingPreference('qwen3.8:27b', settings('low'), reported))).toBe('low')
    expect(resolveStructuredThinkValue(resolveOllamaThinkingPreference('qwen3.8:27b', settings(true), reported))).toBe(true)
    expect(resolveStructuredThinkValue(resolveOllamaThinkingPreference('qwen3.8:27b', settings(false), reported))).toBe(false)
    expect(resolveStructuredThinkValue(resolveOllamaThinkingPreference('qwen3.8:27b', {}, reported))).toBe(false)
  })
})
