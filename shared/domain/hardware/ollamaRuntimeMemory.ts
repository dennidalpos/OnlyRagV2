export interface OllamaRuntimeMemoryAllocation {
  totalBytes: number
  gpuBytes: number
  cpuBytes: number
  gpuPercent: number
  cpuPercent: number
}

/** Splits Ollama `/api/ps` runtime allocation without assuming a model-size budget. */
export function resolveOllamaRuntimeMemory(
  sizeBytes: number | undefined,
  sizeVramBytes: number | undefined
): OllamaRuntimeMemoryAllocation | null {
  if (!Number.isFinite(sizeBytes) || (sizeBytes ?? 0) <= 0) return null
  const totalBytes = Math.max(0, sizeBytes!)
  const gpuBytes = Math.min(totalBytes, Math.max(0, Number.isFinite(sizeVramBytes) ? sizeVramBytes! : 0))
  const cpuBytes = totalBytes - gpuBytes

  return {
    totalBytes,
    gpuBytes,
    cpuBytes,
    gpuPercent: Math.round((gpuBytes / totalBytes) * 100),
    cpuPercent: Math.round((cpuBytes / totalBytes) * 100),
  }
}
