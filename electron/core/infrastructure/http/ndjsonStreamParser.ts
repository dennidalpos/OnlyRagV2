/**
 * Shared utility for robust newline-delimited JSON (NDJSON) streaming parser across Ollama HTTP clients.
 */

export function consumeNdjsonChunk(
  currentBuffer: string,
  chunk: string | Buffer,
  onParsed: (parsed: any) => void,
  onWarning?: (err: Error, line: string) => void
): string {
  const combined = currentBuffer + (typeof chunk === 'string' ? chunk : chunk.toString('utf-8'))
  const lines = combined.split('\n')
  const remainder = lines.pop() || ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      onParsed(parsed)
    } catch (err: any) {
      if (onWarning) {
        onWarning(err, trimmed)
      }
    }
  }

  return remainder
}
