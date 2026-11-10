import { countTokens } from 'gpt-tokenizer'
import { APPROX_CHARS_PER_TOKEN } from './charsPerToken'

const MIN_CONTEXT_SAFETY_TOKENS = 256
const CONTEXT_SAFETY_RATIO = 0.02

/**
 * A run of one repeated character at least this long is approximated instead of encoded: BPE is
 * quadratic on it (100k identical characters take ~4 s, and far longer under coverage).
 */
const REPEATED_RUN = /(.)\1{511,}/gs

/**
 * Counts actual BPE tokens using gpt-tokenizer (o200k_base), falling back to character approximation.
 * Long single-character runs count by the conservative character ratio.
 */
export function countPromptTokens(prompt: string | number): number {
  if (typeof prompt === 'number') {
    return Math.ceil(Math.max(0, prompt) / APPROX_CHARS_PER_TOKEN)
  }
  if (!prompt || typeof prompt !== 'string') return 0
  try {
    let runTokens = 0
    const encodable = prompt.replace(REPEATED_RUN, (run) => {
      runTokens += Math.ceil(run.length / APPROX_CHARS_PER_TOKEN)
      return ' '
    })
    return countTokens(encodable) + runTokens
  } catch {
    return Math.ceil(prompt.length / APPROX_CHARS_PER_TOKEN)
  }
}

/** Maximum generation budget that still keeps the composed prompt inside the selected window. */
export function calculateAvailableOutputTokens(prompt: string, contextWindowTokens: number, safetyTokens?: number): number {
  const window = Math.max(1, Math.floor(contextWindowTokens))
  const safety = safetyTokens ?? Math.max(MIN_CONTEXT_SAFETY_TOKENS, Math.ceil(window * CONTEXT_SAFETY_RATIO))
  return Math.max(1, window - countPromptTokens(prompt) - safety)
}
