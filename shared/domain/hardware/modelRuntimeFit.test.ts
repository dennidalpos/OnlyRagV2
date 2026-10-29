import { describe, expect, it } from 'vitest'
import { assessModelRuntimeFit, parseMemoryGeometry } from './modelRuntimeFit'
import type { OllamaModelMetrics } from '../../types'

const GIB = 1024 ** 3
const geometry = parseMemoryGeometry({
  'general.architecture': 'llama',
  'llama.block_count': 32,
  'llama.embedding_length': 4096,
  'llama.attention.head_count': 32,
  'llama.attention.head_count_kv': 8,
})!
const metric: OllamaModelMetrics = { capabilities: ['completion'], memoryGeometry: geometry, sizeBytes: 4 * GIB, digest: 'same', quantizationLevel: 'Q4_K_M' }
const gpu = { hasGpu: true, vramTotalMB: 16 * 1024, systemRamGB: 32 }

describe('model/workload memory fit', () => {
  it('uses actual geometry and an independent cache range with explicit uncertainty', () => {
    const result = assessModelRuntimeFit('custom', 4096, gpu, metric)
    expect(result.basis).toBe('metadata')
    expect(result.minimumGB).toBeCloseTo(4.25 + 0.140625)
    expect(result.maximumGB).toBeCloseTo(4.25 + 0.5)
    expect(result.placement).toBe('gpu_possible')
    expect(result.uncertain).toBe(true)
    expect(assessModelRuntimeFit('custom', 4096, gpu, { ...metric, quantizationLevel: 'Q8_0' })).toEqual(result)
    expect(assessModelRuntimeFit('custom', 16384, gpu, metric).maximumGB).toBeCloseTo(6.25)
  })

  it('respects different KV heads and key/value dimensions', () => {
    const narrow = { ...metric, memoryGeometry: { ...geometry, kvHeadCount: 2, keyLength: 64, valueLength: 128 } }
    expect(assessModelRuntimeFit('custom', 4096, gpu, narrow).maximumGB).toBeCloseTo(4.25 + 0.09375)
  })

  it('separates CPU/offload possibilities from GPU residency and insufficiency', () => {
    expect(assessModelRuntimeFit('custom', 4096, { ...gpu, vramTotalMB: 4096 }, metric).placement).toBe('cpu_offload_possible')
    expect(assessModelRuntimeFit('custom', 4096, { hasGpu: false, systemRamGB: 16 }, metric).placement).toBe('cpu_possible')
    expect(assessModelRuntimeFit('custom', 4096, { hasGpu: false, systemRamGB: 4 }, metric).placement).toBe('insufficient')
    // Combined memory may support splitting, but loading/transient allocations are not known.
    expect(assessModelRuntimeFit('custom', 4096, { ...gpu, vramTotalMB: 8192, systemRamGB: 8 }, { ...metric, sizeBytes: 8 * GIB }).placement).toBe('unknown')
  })

  it.each(['qwen35', 'gemma3', 'unknown'])('keeps unsupported layout uncertain without fabricating conventional KV (%s)', (architecture) => {
    const memoryGeometry = parseMemoryGeometry({ 'general.architecture': architecture, [`${architecture}.block_count`]: 32 })
    expect(memoryGeometry?.layout).toBe('unsupported')
    const result = assessModelRuntimeFit('custom', 4096, gpu, { ...metric, memoryGeometry })
    expect(result.maximumGB).toBeUndefined()
    expect(result.placement).toBe('unknown')
  })

  it('rejects missing/malformed geometry and complex shared/sliding caches', () => {
    expect(parseMemoryGeometry(null)).toBeUndefined()
    expect(parseMemoryGeometry({ 'general.architecture': [] })).toBeUndefined()
    const raw = { 'general.architecture': 'llama', 'llama.block_count': '32', 'llama.attention.head_count': -1 }
    expect(parseMemoryGeometry(raw)?.blockCount).toBeUndefined()
    expect(parseMemoryGeometry({ ...raw, 'llama.attention.sliding_window': 4096 })?.layout).toBe('unsupported')
    expect(assessModelRuntimeFit('custom', 4096, gpu, { ...metric, memoryGeometry: undefined }).placement).toBe('unknown')
    expect(assessModelRuntimeFit('custom', NaN, gpu, metric).placement).toBe('unknown')
  })

  it('never treats local hardware or a tag heuristic as confirmed remote/installed fit', () => {
    expect(assessModelRuntimeFit('custom', 4096, undefined, metric).placement).toBe('unknown')
    expect(assessModelRuntimeFit('custom:7b', 4096, gpu, { ...metric, sizeBytes: undefined }).placement).toBe('unknown')
  })

  it.each(['same', 'context', 'digest', 'age', 'malformed'] as const)('uses observations only for fresh matching context/digest (%s)', (scenario) => {
    const runtimeAllocation = { observedAt: 100_000, digest: 'same', contextLength: 4096, totalBytes: 6 * GIB, gpuBytes: 3 * GIB }
    if (scenario === 'context') runtimeAllocation.contextLength = 8192
    if (scenario === 'digest') runtimeAllocation.digest = 'different'
    if (scenario === 'age') runtimeAllocation.observedAt = 1
    if (scenario === 'malformed') runtimeAllocation.gpuBytes = 7 * GIB
    const result = assessModelRuntimeFit('custom', 4096, gpu, { ...metric, runtimeAllocation }, 100_100)
    expect(result.basis).toBe(scenario === 'same' ? 'observed' : 'metadata')
    if (scenario === 'same') {
      expect(result.placement).toBe('cpu_offload_possible')
      expect(result.minimumGB).toBe(6)
      expect(result.uncertain).toBe(false)
    }
  })
})
