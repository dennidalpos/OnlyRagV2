
import { countTokens } from 'gpt-tokenizer'

const MAX_CACHE_ENTRIES = 1000
const tokenCountCache = new Map<string, number>()

export function clearTokenEstimateCache(): void {
  tokenCountCache.clear()
}

export function estimateTokenCount(text: string | undefined | null): number {
  if (!text) return 0
  const cached = tokenCountCache.get(text)
  if (cached !== undefined) return cached

  let count: number
  try {
    count = countTokens(text)
  } catch {
    // Pathological input (e.g. an unpaired surrogate) — fall back to a conservative estimate.
    count = Math.ceil(text.length / 4)
  }

  if (tokenCountCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = tokenCountCache.keys().next().value
    if (oldestKey !== undefined) {
      tokenCountCache.delete(oldestKey)
    }
  }
  tokenCountCache.set(text, count)
  return count
}
