export function getOllamaModelIdentity(model: string): string {
  const normalized = model.trim().toLowerCase()
  return normalized.includes(':') ? normalized : `${normalized}:latest`
}

export function buildOllamaModelOptions(models: readonly string[], currentModel?: string, preferredModels: readonly string[] = []): string[] {
  const options = new Set<string>()
  const identities = new Set<string>()
  for (const model of preferredModels) {
    const trimmed = model.trim()
    if (trimmed && !identities.has(getOllamaModelIdentity(trimmed))) {
      options.add(trimmed)
      identities.add(getOllamaModelIdentity(trimmed))
    }
  }
  for (const model of models) {
    const trimmed = model.trim()
    if (trimmed && !identities.has(getOllamaModelIdentity(trimmed))) {
      options.add(trimmed)
      identities.add(getOllamaModelIdentity(trimmed))
    }
  }
  const current = currentModel?.trim()
  if (current && !identities.has(getOllamaModelIdentity(current))) options.add(current)
  return Array.from(options)
}
