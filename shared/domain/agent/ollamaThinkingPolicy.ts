import type { AppSettings, OllamaModelMetrics, OllamaThinkValue } from '../../types'
import { findExactInstalledModelAlias, parseModelTagComponents } from './modelTagMatcher'

export type OllamaThinkingMode = 'binary' | 'level-only' | 'unsupported' | 'unknown'

export interface OllamaThinkingResolution {
  mode: OllamaThinkingMode
  installedModel: string | null
  enabled: boolean
  think: boolean
  /** Named reasoning levels the model reports in /api/show, in Ollama's order. */
  levels: string[]
  /** The model's own `think` default from /api/show, when reported. */
  modelDefault?: OllamaThinkValue
  /** The reasoning level the user picked, when thinking is enabled through a level rather than `true`. */
  level?: string
}

type ThinkingSupport = Omit<OllamaThinkingResolution, 'enabled' | 'think'>

/** Fallback for Ollama builds whose /api/show has no `thinking` block: gpt-oss only accepts levels. */
function isLegacyLevelOnlyFamily(model: string, metrics: OllamaModelMetrics): boolean {
  const family =
    metrics.family
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || ''
  const baseName = parseModelTagComponents(model).baseName.replace(/[^a-z0-9]/g, '')
  return family === 'gptoss' || baseName.startsWith('gptoss')
}

/**
 * Classifies thinking support from the metadata Ollama reports. `/api/show` lists the accepted
 * `think` values: a model that lists `false` can be switched off (binary, possibly with levels),
 * one that lists only levels cannot (level-only).
 */
export function resolveOllamaThinkingMode(model: string, modelMetrics: Record<string, OllamaModelMetrics>): ThinkingSupport {
  const installedModel = findExactInstalledModelAlias(model, Object.keys(modelMetrics))
  if (!installedModel) return { mode: 'unknown', installedModel: null, levels: [] }

  const metrics = modelMetrics[installedModel]
  if (!metrics?.capabilities.includes('thinking')) return { mode: 'unsupported', installedModel, levels: [] }

  const reported = metrics.thinking
  if (reported && reported.values.length > 0) {
    const levels = reported.values.filter((value): value is string => typeof value === 'string')
    const switchable = reported.values.includes(false)
    return { mode: switchable ? 'binary' : 'level-only', installedModel, levels, modelDefault: reported.default }
  }
  if (isLegacyLevelOnlyFamily(installedModel, metrics)) return { mode: 'level-only', installedModel, levels: ['low', 'medium', 'high'] }
  if (!metrics.capabilities.includes('completion')) return { mode: 'unsupported', installedModel, levels: [] }
  return { mode: 'binary', installedModel, levels: [] }
}

/** The user's stored preference for a model, kept only when the model accepts it. */
function acceptedPreference(support: ThinkingSupport, preferences: AppSettings['modelThinkingPreferences'], model: string): OllamaThinkValue | undefined {
  if (!support.installedModel) return undefined
  const stored = preferences?.[support.installedModel] ?? preferences?.[model]
  if (stored === undefined) return undefined
  if (typeof stored === 'string') return support.levels.includes(stored) ? stored : undefined
  if (support.mode === 'binary') return stored
  // A level-only model cannot be switched: "on" maps to its default level, "off" to its lowest.
  if (support.mode === 'level-only') return stored ? (support.modelDefault ?? support.levels[0]) : support.levels[0]
  return undefined
}

/**
 * Thinking switch for the chat, translation and ingestion features. They stay off unless the user
 * enabled thinking (or picked a level) for a switchable model. Every non-binary case fails closed.
 */
export function resolveOllamaThinkingPreference(
  model: string,
  settings: Pick<AppSettings, 'modelThinkingPreferences'>,
  modelMetrics: Record<string, OllamaModelMetrics>,
): OllamaThinkingResolution {
  const support = resolveOllamaThinkingMode(model, modelMetrics)
  const preference = acceptedPreference(support, settings.modelThinkingPreferences, model)
  const enabled = support.mode === 'binary' && preference !== undefined && preference !== false
  return { ...support, enabled, think: enabled, ...(enabled && typeof preference === 'string' ? { level: preference } : {}) }
}

/**
 * The `think` value for a Coding Agent turn. An explicit per-model preference wins; without one the
 * field is omitted (undefined), so Ollama applies the model's own default, as its docs describe for
 * `think: null`. Models without thinking support never receive the field.
 */
export function resolveAgentThinkValue(
  model: string,
  settings: Pick<AppSettings, 'modelThinkingPreferences'>,
  modelMetrics: Record<string, OllamaModelMetrics>,
): OllamaThinkValue | undefined {
  const support = resolveOllamaThinkingMode(model, modelMetrics)
  if (support.mode !== 'binary' && support.mode !== 'level-only') return undefined
  return acceptedPreference(support, settings.modelThinkingPreferences, model)
}

/** Stores a preference; `undefined` removes it so the model default applies again. */
export function updateModelThinkingPreference(
  preferences: Record<string, OllamaThinkValue> | undefined,
  model: string,
  value: OllamaThinkValue | undefined,
): Record<string, OllamaThinkValue> {
  const next = { ...(preferences || {}) }
  if (value === undefined) delete next[model]
  else next[model] = value
  return next
}

/**
 * The `think` value for a structured (JSON schema) request. A level-only model cannot switch its
 * reasoning off, and `think: false` left gpt-oss:20b with empty content under a schema (827 output
 * tokens, `done_reason=stop`, 2026-09-24): it gets its lowest level instead, which returns JSON.
 */
export function resolveStructuredThinkValue(resolution: Pick<OllamaThinkingResolution, 'mode' | 'think' | 'levels' | 'level'>): OllamaThinkValue {
  if (resolution.mode === 'level-only') return resolution.levels[0] ?? 'low'
  // A chosen level is sent as that level: `true` would run the model's default ("medium" for
  // qwen3.8:27b), which timed out plan generation twice at about 2 tok/s on 2026-09-26.
  return resolution.think && resolution.level ? resolution.level : resolution.think
}
