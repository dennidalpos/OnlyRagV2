import { MIN_MODEL_CONTEXT_LENGTH } from './modelContextPreference'

/** Persists the hardware-safe setup window for newly selected generative models. */
export function buildSetupModelContextPreferences(
  models: readonly (string | undefined)[],
  existing: Record<string, number> | undefined,
  hardwareContext: number,
): Record<string, number> {
  const next = { ...(existing || {}) }
  const safeContext = Math.max(MIN_MODEL_CONTEXT_LENGTH, Math.floor(hardwareContext))
  for (const model of models) {
    const normalized = model?.trim()
    if (normalized && next[normalized] === undefined) next[normalized] = safeContext
  }
  return next
}
