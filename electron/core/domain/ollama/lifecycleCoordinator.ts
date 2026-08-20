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

// NOTE: This file previously also carried a `resolveModelKeepAlive`/`isModelLoaded` policy
// engine (scope-based keep_alive resolution + VRAM-residency lookup) and, before that,
// `calculateVramAllocationRatio`. All three had zero production callers — real keep_alive
// values are hardcoded at their call sites (agentStreamTransport.ts, ollamaHttpClient.ts),
// and VRAM eviction is actually handled by resilientModelDispatcher.ts's /api/ps check. Do
// not reintroduce a second, unwired policy layer here; only these shared Ollama API types
// remain because ollamaHttpClient.ts imports them.
