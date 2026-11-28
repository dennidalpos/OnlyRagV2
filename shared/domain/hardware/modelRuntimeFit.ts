import type { OllamaMemoryGeometry, OllamaModelMetrics } from '../../types'
import { calculateRealUsableVram, calculateUsableSystemRamGB, type HardwareFacts } from './hardwareProfileTiers'
import { estimateModelWeightGB } from './modelWeightEstimator'

const GIB = 1024 ** 3
const positive = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum

/** Keep scalar geometry only; hybrid/shared/sliding layouts need runtime evidence. */
export function parseMemoryGeometry(raw: unknown): OllamaMemoryGeometry | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const info = raw as Record<string, unknown>
  const architecture = info['general.architecture']
  if (typeof architecture !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(architecture)) return undefined
  const number = (key: string) => {
    const value = info[`${architecture}.${key}`]
    return positive(value, 1_000_000) && Number.isInteger(value) ? value : undefined
  }
  const complex = Object.entries(info).some(
    ([key, value]) => key.startsWith(`${architecture}.`) && /sliding_window|shared_kv|swa|recurrent|ssm/.test(key) && value !== 0 && value !== false,
  )
  return {
    architecture,
    layout: ['llama', 'qwen2', 'qwen3'].includes(architecture) && !complex ? 'full-attention' : 'unsupported',
    blockCount: number('block_count'),
    embeddingLength: number('embedding_length'),
    headCount: number('attention.head_count'),
    kvHeadCount: number('attention.head_count_kv'),
    keyLength: number('attention.key_length'),
    valueLength: number('attention.value_length'),
  }
}

export interface ModelFitVerdict {
  placement: 'gpu_possible' | 'cpu_offload_possible' | 'cpu_possible' | 'insufficient' | 'unknown'
  contextTokens: number
  minimumGB: number
  maximumGB?: number
  basis: 'observed' | 'metadata' | 'weight-only'
  uncertain: boolean
}

/** Informational single-request assessment; never changes admission or context limits. */
export function assessModelRuntimeFit(
  model: string,
  contextTokens: number,
  facts: HardwareFacts | undefined,
  metrics?: OllamaModelMetrics,
  now = Date.now(),
): ModelFitVerdict {
  const weight = positive(metrics?.sizeBytes)
    ? metrics.sizeBytes / GIB
    : estimateModelWeightGB(model, { parameter_size: metrics?.parameterSize, quantization_level: metrics?.quantizationLevel })
  const result: ModelFitVerdict = { placement: 'unknown', contextTokens, minimumGB: weight, basis: 'weight-only', uncertain: true }
  const ram = positive(facts?.systemRamGB) ? calculateUsableSystemRamGB(facts.systemRamGB) : undefined
  const vram = facts?.hasGpu && positive(facts.vramTotalMB) ? calculateRealUsableVram(facts.vramTotalMB) : 0
  if (!positive(contextTokens, 10_000_000) || !Number.isInteger(contextTokens)) return result
  const measured = metrics?.runtimeAllocation
  if (
    measured &&
    metrics?.digest &&
    measured.digest === metrics.digest &&
    measured.contextLength === contextTokens &&
    positive(measured.totalBytes) &&
    Number.isFinite(measured.gpuBytes) &&
    measured.gpuBytes >= 0 &&
    measured.gpuBytes <= measured.totalBytes &&
    now >= measured.observedAt &&
    now - measured.observedAt <= 60_000
  ) {
    result.minimumGB = result.maximumGB = measured.totalBytes / GIB
    result.basis = 'observed'
    if (facts && ram !== undefined) {
      if (measured.gpuBytes > 0 && (!facts.hasGpu || !positive(facts.vramTotalMB))) return result
      const cpu = (measured.totalBytes - measured.gpuBytes) / GIB
      if (measured.gpuBytes / GIB <= vram && cpu <= ram) {
        result.placement = measured.gpuBytes === measured.totalBytes ? 'gpu_possible' : measured.gpuBytes > 0 ? 'cpu_offload_possible' : 'cpu_possible'
        result.uncertain = false
      } else result.placement = 'insufficient'
    }
    return result
  }
  const g = metrics?.memoryGeometry
  const key = g?.keyLength ?? (g?.embeddingLength && g.headCount ? g.embeddingLength / g.headCount : undefined)
  const value = g?.valueLength ?? key
  if (g?.layout === 'full-attention' && positive(g.blockCount) && positive(g.kvHeadCount) && positive(key) && positive(value)) {
    const elements = g.blockCount * g.kvHeadCount * (key + value) * contextTokens
    // Cache is independent of weight quantization; range covers Q4_0 through F16, one sequence.
    result.minimumGB = weight + (elements * (18 / 32)) / GIB + 0.25
    result.maximumGB = weight + (elements * 2) / GIB + 0.25
    result.basis = 'metadata'
  }
  if (!facts || ram === undefined || !positive(metrics?.sizeBytes)) return result
  if (result.maximumGB !== undefined) {
    if (result.maximumGB <= vram) result.placement = 'gpu_possible'
    else if (result.maximumGB <= ram) result.placement = vram > 0 ? 'cpu_offload_possible' : 'cpu_possible'
    else if (result.minimumGB > vram + ram) result.placement = 'insufficient'
  } else if (weight > vram + ram) result.placement = 'insufficient'
  return result
}
