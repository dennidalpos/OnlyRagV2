import { countPromptTokens } from '../../shared/domain/agent/contextWindowCalculator'

/**
 * Bounded by entries AND characters: the prompt editor used to cache one full draft per
 * keystroke, so a long template filled the cache with up to 1000 near-identical copies.
 */
const MAX_CACHE_ENTRIES = 200
const MAX_CACHE_CHARS = 2_000_000
const tokenCountCache = new Map<string, number>()
let cachedChars = 0

/** @internal Resets the cache between tests. */
export function clearTokenEstimateCache(): void {
  tokenCountCache.clear()
  cachedChars = 0
}

/** @internal Entries and characters currently held; exposed for the cache-bound tests. */
export function tokenEstimateCacheSize(): { entries: number; chars: number } {
  return { entries: tokenCountCache.size, chars: cachedChars }
}

export function estimateTokenCount(text: string | undefined | null): number {
  if (!text) return 0
  const cached = tokenCountCache.get(text)
  if (cached !== undefined) return cached

  const count = countPromptTokens(text)
  // A text larger than the whole budget is counted but never cached.
  if (text.length > MAX_CACHE_CHARS) return count

  tokenCountCache.set(text, count)
  cachedChars += text.length
  for (const oldestKey of tokenCountCache.keys()) {
    if (tokenCountCache.size <= MAX_CACHE_ENTRIES && cachedChars <= MAX_CACHE_CHARS) break
    tokenCountCache.delete(oldestKey)
    cachedChars -= oldestKey.length
  }
  return count
}
