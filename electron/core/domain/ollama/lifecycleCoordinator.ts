export interface RunningModelDetails {
  parent_model?: string
  format?: string
  family?: string
  families?: string[]
  parameter_size?: string
  quantization_level?: string
}

export interface RunningModelInfo {
  name: string
  model: string
  size: number
  digest?: string
  details?: RunningModelDetails
  expires_at?: string
  size_vram?: number
}

export type ModelTaskScope = 'primary_pinned' | 'standard' | 'ephemeral' | 'benchmark'

export interface LifecyclePolicyConfig {
  pinnedKeepAlive?: string
  standardKeepAlive?: string
  ephemeralKeepAlive?: string
}

export const DEFAULT_LIFECYCLE_CONFIG: Required<LifecyclePolicyConfig> = {
  pinnedKeepAlive: '30m',
  standardKeepAlive: '5m',
  ephemeralKeepAlive: '0m',
}

/**
 * Resolves the keep_alive duration string for Ollama based on the task scope.
 * Pinned models (e.g. primary coding studio agent) stay resident in VRAM.
 * Ephemeral tasks (e.g. one-off translation, fast OCR, benchmarks) are evicted immediately ('0m').
 */
export function resolveModelKeepAlive(
  scope: ModelTaskScope,
  customConfig?: LifecyclePolicyConfig
): string {
  const config = { ...DEFAULT_LIFECYCLE_CONFIG, ...customConfig }
  switch (scope) {
    case 'primary_pinned':
      return config.pinnedKeepAlive
    case 'ephemeral':
    case 'benchmark':
      return config.ephemeralKeepAlive
    case 'standard':
    default:
      return config.standardKeepAlive
  }
}

/**
 * Checks whether a given model tag or name is currently loaded in Ollama's active VRAM.
 */
export function isModelLoaded(targetModel: string, loadedModels: RunningModelInfo[]): boolean {
  if (!targetModel || !loadedModels || loadedModels.length === 0) return false
  const cleanTarget = targetModel.trim().toLowerCase()
  const baseTarget = cleanTarget.split(':')[0]

  return loadedModels.some((m) => {
    const cleanName = (m.name || m.model || '').toLowerCase()
    const baseName = cleanName.split(':')[0]
    return cleanName === cleanTarget || cleanName.startsWith(`${cleanTarget}:`) || baseName === baseTarget
  })
}

/**
 * Computes memory allocation strategy based on VRAM capacity and unified memory flags.
 */
export function calculateVramAllocationRatio(
  modelSizeBytes: number,
  vramTotalBytes: number,
  isUnifiedMemory: boolean = false
): { fitsInVram: boolean; utilizationPercent: number; suggestedNgl: number } {
  if (vramTotalBytes <= 0) {
    return { fitsInVram: false, utilizationPercent: 100, suggestedNgl: 0 }
  }

  // Unified memory (Apple Silicon / APU) allows higher headroom (~80%) vs discrete GPU (~90%)
  const maxUsableVram = vramTotalBytes * (isUnifiedMemory ? 0.75 : 0.88)
  const fitsInVram = modelSizeBytes <= maxUsableVram
  const utilizationPercent = Math.min(100, Math.round((modelSizeBytes / vramTotalBytes) * 100))
  const suggestedNgl = fitsInVram ? 99 : Math.max(1, Math.floor((maxUsableVram / modelSizeBytes) * 33))

  return { fitsInVram, utilizationPercent, suggestedNgl }
}
