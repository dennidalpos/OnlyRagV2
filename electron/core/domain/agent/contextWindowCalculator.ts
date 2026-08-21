/**
 * Context Window Calculator for Local Ollama LLM Inference.
 * Computes optimal dynamic num_ctx based on prompt character length and completion headroom.
 * Prevents allocating redundant KV-Cache in VRAM while avoiding truncation.
 */

import { countTokens } from 'gpt-tokenizer'

const STANDARD_CONTEXT_BUCKETS = [2048, 4096, 8192, 16384, 32768, 65536]
const COMPLETION_HEADROOM_TOKENS = 2048
const MIN_CONTEXT_TOKENS = 2048
const DEFAULT_MAX_CONTEXT_TOKENS = 32768

/**
 * Counts actual BPE tokens using gpt-tokenizer (o200k_base), falling back to character approximation.
 */
export function countPromptTokens(prompt: string | number): number {
  if (typeof prompt === 'number') {
    return Math.ceil(Math.max(0, prompt) / 3.8)
  }
  if (!prompt || typeof prompt !== 'string') return 0
  try {
    return countTokens(prompt)
  } catch {
    return Math.ceil(prompt.length / 3.8)
  }
}

export function calculateDynamicContextWindow(
  promptOrChars: string | number,
  hardwareMaxCtx?: number,
  headroomTokens: number = COMPLETION_HEADROOM_TOKENS
): number {
  const estimatedPromptTokens = countPromptTokens(promptOrChars)
  const totalRequiredTokens = estimatedPromptTokens + headroomTokens

  const maxAllowed = hardwareMaxCtx && hardwareMaxCtx >= MIN_CONTEXT_TOKENS
    ? hardwareMaxCtx
    : DEFAULT_MAX_CONTEXT_TOKENS

  let chosenBucket = STANDARD_CONTEXT_BUCKETS[0]
  for (const bucket of STANDARD_CONTEXT_BUCKETS) {
    if (bucket >= totalRequiredTokens) {
      chosenBucket = bucket
      break
    }
    chosenBucket = bucket
  }

  // Clamp within [MIN_CONTEXT_TOKENS, maxAllowed]
  return Math.max(MIN_CONTEXT_TOKENS, Math.min(chosenBucket, maxAllowed))
}
