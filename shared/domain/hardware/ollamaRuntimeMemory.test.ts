import { describe, expect, it } from 'vitest'
import { resolveOllamaRuntimeMemory } from './ollamaRuntimeMemory'

describe('resolveOllamaRuntimeMemory', () => {
  it('reports the measured GPU/CPU split from Ollama runtime bytes', () => {
    expect(resolveOllamaRuntimeMemory(10_000, 7_500)).toEqual({
      totalBytes: 10_000,
      gpuBytes: 7_500,
      cpuBytes: 2_500,
      gpuPercent: 75,
      cpuPercent: 25,
    })
  })

  it('clamps inconsistent values and rejects absent runtime size', () => {
    expect(resolveOllamaRuntimeMemory(1_000, 2_000)?.cpuBytes).toBe(0)
    expect(resolveOllamaRuntimeMemory(undefined, 500)).toBeNull()
  })
})
