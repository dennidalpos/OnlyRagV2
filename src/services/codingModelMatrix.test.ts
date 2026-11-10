import { describe, it, expect } from 'vitest'
import { declaresToolCalling, resolveModelRuntimeStatus } from '../../shared/domain/agent/codingModelQualification'

describe('resolveModelRuntimeStatus', () => {
  it('does not promote a tested tag beyond runtime compatibility', () => {
    for (const modelName of ['qwen2.5-coder:7b', 'qwen3.5:9b']) {
      expect(resolveModelRuntimeStatus({ modelName, capabilities: ['completion', 'tools'] })).toBe('compatible')
      expect(resolveModelRuntimeStatus({ modelName, capabilities: ['completion'] })).toBe('unsupported')
      expect(resolveModelRuntimeStatus({ modelName })).toBe('unknown')
    }
  })

  // The distinction the badge exists to make: catalogued and usable is not the same as tested.
  it('marks an installed untested tool model compatible, never verified', () => {
    expect(resolveModelRuntimeStatus({ modelName: 'deepseek-coder:6.7b', capabilities: ['completion', 'tools'] })).toBe('compatible')
  })

  it('marks an unknown model without capability metadata as unknown', () => {
    expect(resolveModelRuntimeStatus({ modelName: 'some-fork/custom:latest' })).toBe('unknown')
  })

  // The agent is a tool-calling loop; an embedding model has no chat surface at all.
  it('marks embedding families unsupported', () => {
    for (const name of ['nomic-embed-text:latest', 'mxbai-embed-large:latest', 'bge-m3:latest', 'embeddinggemma:latest']) {
      expect(resolveModelRuntimeStatus({ modelName: name })).toBe('unsupported')
    }
  })

  it('marks an installed model that reports no tool capability as unsupported', () => {
    expect(resolveModelRuntimeStatus({ modelName: 'deepseek-coder:6.7b', capabilities: ['completion'] })).toBe('unsupported')
  })

  // A model that is not installed yet reports no capabilities at all, and the badge still has
  // to render — the wizard shows it before the download.
  it('does not infer tool support before Ollama reports capabilities', () => {
    expect(resolveModelRuntimeStatus({ modelName: 'deepseek-coder:6.7b' })).toBe('unknown')
  })

  it('answers unknown for an empty name instead of throwing', () => {
    expect(resolveModelRuntimeStatus({ modelName: '' })).toBe('unknown')
  })
})

describe('declaresToolCalling', () => {
  it('reads the capability Ollama actually reports', () => {
    expect(declaresToolCalling(['completion', 'tools'])).toBe(true)
    expect(declaresToolCalling(['completion'])).toBe(false)
    expect(declaresToolCalling(undefined)).toBe(false)
  })
})
