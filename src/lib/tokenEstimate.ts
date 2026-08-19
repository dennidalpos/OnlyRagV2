/**
 * Approximate token count for the context-usage banner in Coding Agent Studio. Ollama exposes
 * no tokenizer API and local model vocabularies differ (Llama, Qwen, Phi, ...), so there is no
 * single "real" tokenizer to call here — this uses gpt-tokenizer's o200k_base (GPT-4o) BPE
 * encoding as a stand-in, which tracks actual token boundaries far more closely than a raw
 * character count (the previous heuristic) while remaining an estimate, not an exact count for
 * the model actually running.
 */
import { countTokens } from 'gpt-tokenizer'

export function estimateTokenCount(text: string | undefined | null): number {
  if (!text) return 0
  try {
    return countTokens(text)
  } catch {
    // Pathological input (e.g. an unpaired surrogate) — fall back to a conservative estimate.
    return Math.ceil(text.length / 4)
  }
}
