import type { OllamaRuntimeOptions } from './hardwareProfileResolver'
import type { OllamaModelMetrics, RunningModelInfo } from '../../../../shared/types'

export interface OllamaSessionRuntimeProfile {
  model: string
  host: string
  digest?: string
  options: OllamaRuntimeOptions
}

export interface OllamaGenerationTelemetry {
  step: number
  model: string
  numCtx: number
  startedAt: string
  wallDurationMs: number
  totalDurationMs?: number
  loadDurationMs?: number
  promptEvalDurationMs?: number
  evalDurationMs?: number
  promptTokens?: number
  completionTokens?: number
  memoryTotalBytes?: number
  memoryGpuBytes?: number
  memoryCpuBytes?: number
  loadedContextLength?: number
}

export type OllamaStreamTelemetry = Omit<OllamaGenerationTelemetry, 'step' | 'memoryTotalBytes' | 'memoryGpuBytes' | 'memoryCpuBytes' | 'loadedContextLength'>

export function normalizeOllamaHost(host?: string): string {
  const value = host?.trim() || 'http://127.0.0.1:11434'
  return (value.startsWith('http') ? value : `http://${value}`).replace(/\/$/, '')
}

export function validateRestoredOllamaRuntime(
  profile: OllamaSessionRuntimeProfile,
  currentHost: string | undefined,
  availableModels: readonly string[],
  metrics: Record<string, OllamaModelMetrics>
): string | null {
  const options = profile?.options as Partial<OllamaRuntimeOptions> | undefined
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  if (
    typeof profile?.model !== 'string' || !profile.model.trim() ||
    typeof profile?.host !== 'string' || !options ||
    !finite(options.num_ctx) || options.num_ctx! <= 0 ||
    !finite(options.num_predict) || options.num_predict! <= 0 ||
    !finite(options.maxContextChars) || options.maxContextChars! <= 0 ||
    !finite(options.temperature) || !finite(options.top_p) || !finite(options.repeat_penalty) ||
    !Array.isArray(options.stop) || options.stop.some((value) => typeof value !== 'string')
  ) {
    return 'Persisted Ollama runtime profile is invalid.'
  }
  if (normalizeOllamaHost(profile.host) !== normalizeOllamaHost(currentHost)) {
    return `Ollama host changed since checkpoint (${profile.host} → ${normalizeOllamaHost(currentHost)}).`
  }
  if (!availableModels.includes(profile.model)) {
    return `Pinned Ollama model '${profile.model}' is no longer installed.`
  }
  if (profile.digest && metrics[profile.model]?.digest !== profile.digest) {
    return `Pinned Ollama model '${profile.model}' changed digest since checkpoint.`
  }
  return null
}

export function enrichOllamaGenerationTelemetry(
  telemetry: OllamaStreamTelemetry,
  step: number,
  loaded?: RunningModelInfo
): OllamaGenerationTelemetry {
  const total = loaded?.size
  const gpu = loaded?.size_vram
  return {
    ...telemetry,
    step,
    memoryTotalBytes: total,
    memoryGpuBytes: gpu,
    memoryCpuBytes: total !== undefined && gpu !== undefined ? Math.max(0, total - gpu) : undefined,
    loadedContextLength: loaded?.context_length,
  }
}
