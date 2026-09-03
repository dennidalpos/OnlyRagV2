/**
 * Approximate token count for the context-usage banner in Coding Agent Studio. Ollama exposes
 * no tokenizer API and local model vocabularies differ (Llama, Qwen, Phi, ...), so there is no
 * single "real" tokenizer to call here — this uses gpt-tokenizer's o200k_base (GPT-4o) BPE
 * encoding as a stand-in, which tracks actual token boundaries far more closely than a raw
 * character count (the previous heuristic) while remaining an estimate, not an exact count for
 * the model actually running.
 */
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
