/**
 * Context Window Calculator for Local Ollama LLM Inference.
 * Computes optimal dynamic num_ctx based on prompt character length and completion headroom.
 * Prevents allocating redundant KV-Cache in VRAM while avoiding truncation.
 */

const STANDARD_CONTEXT_BUCKETS = [2048, 4096, 8192, 16384, 32768, 65536]
const CHARS_PER_TOKEN_ESTIMATE = 3.8
const COMPLETION_HEADROOM_TOKENS = 2048
const MIN_CONTEXT_TOKENS = 2048
const DEFAULT_MAX_CONTEXT_TOKENS = 32768

export function calculateDynamicContextWindow(
  promptLengthChars: number,
  hardwareMaxCtx?: number,
  headroomTokens: number = COMPLETION_HEADROOM_TOKENS
): number {
  const safePromptChars = Math.max(0, promptLengthChars || 0)
  const estimatedPromptTokens = Math.ceil(safePromptChars / CHARS_PER_TOKEN_ESTIMATE)
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
