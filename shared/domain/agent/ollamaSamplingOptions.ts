import type { OllamaSamplingOverrides } from '../../types'

/**
 * Sampling keys the app forwards to Ollama only when explicitly set. Anything left unset keeps the
 * model's Modelfile defaults, which is what model vendors tune and document: Qwen, for instance,
 * warns that near-greedy decoding in thinking mode causes endless repetition.
 */
const SAMPLING_LIMITS: Record<keyof OllamaSamplingOverrides, { min: number; max: number; integer?: boolean }> = {
  temperature: { min: 0, max: 2 },
  top_p: { min: 0, max: 1 },
  top_k: { min: 1, max: 1000, integer: true },
  min_p: { min: 0, max: 1 },
  repeat_penalty: { min: 0.5, max: 2 },
  presence_penalty: { min: -2, max: 2 },
  num_thread: { min: 1, max: 256, integer: true },
}

/** Keeps only finite, in-range sampling values; everything else is dropped rather than clamped. */
export function pickSamplingOverrides(source: unknown): OllamaSamplingOverrides {
  const picked: OllamaSamplingOverrides = {}
  if (!source || typeof source !== 'object') return picked
  const record = source as Record<string, unknown>
  for (const key of Object.keys(SAMPLING_LIMITS) as (keyof OllamaSamplingOverrides)[]) {
    const value = record[key]
    const limits = SAMPLING_LIMITS[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < limits.min || value > limits.max) continue
    if (limits.integer && !Number.isInteger(value)) continue
    picked[key] = value
  }
  return picked
}

/** The user's overrides for one model, validated. Empty when none are configured. */
export function resolveModelSamplingOverrides(model: string, overrides: Record<string, OllamaSamplingOverrides> | undefined): OllamaSamplingOverrides {
  return pickSamplingOverrides(overrides?.[model])
}

/** Settings sanitizer: drops unknown models' empty entries and invalid values. */
export function sanitizeModelSamplingOverrides(raw: unknown): Record<string, OllamaSamplingOverrides> {
  const sanitized: Record<string, OllamaSamplingOverrides> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return sanitized
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!model.trim()) continue
    const picked = pickSamplingOverrides(value)
    if (Object.keys(picked).length > 0) sanitized[model] = picked
  }
  return sanitized
}
