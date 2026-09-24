import type { AppSettings, OllamaModelMetrics } from '../../types'
import { findExactInstalledModelAlias, parseModelTagComponents } from './modelTagMatcher'

export type OllamaThinkingMode = 'binary' | 'level-only' | 'unsupported' | 'unknown'

export interface OllamaThinkingResolution {
  mode: OllamaThinkingMode
  installedModel: string | null
  enabled: boolean
  think: boolean
}

function isLevelOnlyModel(model: string, metrics: OllamaModelMetrics): boolean {
  const family =
    metrics.family
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || ''
  const baseName = parseModelTagComponents(model).baseName.replace(/[^a-z0-9]/g, '')
  return family === 'gptoss' || baseName.startsWith('gptoss')
}

export function resolveOllamaThinkingMode(
  model: string,
  modelMetrics: Record<string, OllamaModelMetrics>,
): Omit<OllamaThinkingResolution, 'enabled' | 'think'> {
  const installedModel = findExactInstalledModelAlias(model, Object.keys(modelMetrics))
  if (!installedModel) return { mode: 'unknown', installedModel: null }

  const metrics = modelMetrics[installedModel]
  if (!metrics?.capabilities.includes('thinking')) return { mode: 'unsupported', installedModel }
  if (isLevelOnlyModel(installedModel, metrics)) return { mode: 'level-only', installedModel }
  if (!metrics.capabilities.includes('completion')) return { mode: 'unsupported', installedModel }
  return { mode: 'binary', installedModel }
}

/** Returns the effective top-level Ollama `think` value. Every non-binary case fails closed. */
export function resolveOllamaThinkingPreference(
  model: string,
  settings: Pick<AppSettings, 'modelThinkingPreferences'>,
  modelMetrics: Record<string, OllamaModelMetrics>,
): OllamaThinkingResolution {
  const support = resolveOllamaThinkingMode(model, modelMetrics)
  const requested = support.installedModel
    ? (settings.modelThinkingPreferences?.[support.installedModel] ?? settings.modelThinkingPreferences?.[model] ?? false)
    : false
  const enabled = support.mode === 'binary' && requested === true
  return { ...support, enabled, think: enabled }
}

export function updateModelThinkingPreference(preferences: Record<string, boolean> | undefined, model: string, enabled: boolean): Record<string, boolean> {
  return { ...(preferences || {}), [model]: enabled }
}

/**
 * The `think` value for a structured (JSON schema) request. A level-only model cannot switch its
 * reasoning off, and `think: false` left gpt-oss:20b with empty content under a schema (827 output
 * tokens, `done_reason=stop`, 2026-09-24): it gets the lowest level instead, which returns JSON.
 */
export function resolveStructuredThinkValue(resolution: Pick<OllamaThinkingResolution, 'mode' | 'think'>): boolean | 'low' {
  return resolution.mode === 'level-only' ? 'low' : resolution.think
}
