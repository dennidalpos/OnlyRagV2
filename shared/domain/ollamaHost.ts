/** Endpoint of a local Ollama install; the single source for every default-host fallback. */
export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'

/** Canonical form of a configured Ollama host: scheme included, no trailing slash, default when blank. */
export function normalizeOllamaHost(host?: string): string {
  const value = host?.trim() || DEFAULT_OLLAMA_HOST
  return (value.startsWith('http') ? value : `http://${value}`).replace(/\/$/, '')
}
