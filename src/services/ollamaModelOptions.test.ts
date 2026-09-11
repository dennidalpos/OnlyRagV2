import { describe, expect, it } from 'vitest'
import { buildOllamaModelOptions } from './ollamaModelOptions'

describe('buildOllamaModelOptions', () => {
  it('keeps every model reported by Ollama without applying a preset or intent filter', () => {
    expect(buildOllamaModelOptions(['qwen2.5-coder:7b', 'nomic-embed-text:latest', 'llava:7b', 'custom/model:latest'], 'qwen2.5-coder:7b')).toEqual([
      'qwen2.5-coder:7b',
      'nomic-embed-text:latest',
      'llava:7b',
      'custom/model:latest',
    ])
  })

  it('retains a configured model absent from a temporary Ollama response', () => {
    expect(buildOllamaModelOptions(['llama3.2:3b'], 'qwen2.5-coder:7b')).toEqual(['llama3.2:3b', 'qwen2.5-coder:7b'])
  })

  it('puts wizard recommendations first without hiding other available models', () => {
    expect(buildOllamaModelOptions(['custom:latest', 'qwen3:4b'], undefined, ['qwen3:4b', 'qwen2.5:3b'])).toEqual(['qwen3:4b', 'qwen2.5:3b', 'custom:latest'])
  })

  it('does not add a model when no current configuration exists', () => {
    expect(buildOllamaModelOptions(['llama3.2:3b'])).toEqual(['llama3.2:3b'])
  })

  it('does not duplicate the implicit latest tag', () => {
    expect(buildOllamaModelOptions(['nomic-embed-text:latest'], 'nomic-embed-text')).toEqual(['nomic-embed-text:latest'])
  })
})
