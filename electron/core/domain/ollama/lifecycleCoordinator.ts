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

// NOTE: `calculateVramAllocationRatio` was removed here. It had no callers and no tests, and
// it carried a competing VRAM headroom heuristic (0.88 discrete / 0.75 unified) that
// contradicted the single ladder now defined in src/services/hardwareProfileTiers.ts
// (25% safety margin minus a 1.5GB OS reserve). Model fit is decided by
// `assessModelHardwareCompatibility`; do not reintroduce a second formula here.
