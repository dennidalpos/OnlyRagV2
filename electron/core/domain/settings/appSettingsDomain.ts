import type { AppSettings } from '../../../../shared/types'
import { PROMPT_NODE_IDS, type PromptNodeId } from '../../../../shared/domain/agent/promptHierarchyRegistry'
import { normalizeAgentStepBudget } from '../../../../shared/domain/agent/agentStepBudget'
import { DEFAULT_APP_SETTINGS } from '../../../../shared/domain/settings/appSettingsDefaults'

export const MIN_MODEL_CONTEXT_LENGTH = 2048

export function sanitizeModelContextLengths(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: Record<string, number> = {}
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedModel = model.trim()
    if (!normalizedModel || typeof value !== 'number' || !Number.isFinite(value)) continue
    const context = Math.floor(value)
    if (context >= MIN_MODEL_CONTEXT_LENGTH) result[normalizedModel] = context
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export function sanitizeModelThinkingPreferences(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, boolean> = {}
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedModel = model.trim()
    if (!normalizedModel || normalizedModel.length > 200 || typeof value !== 'boolean') continue
    result[normalizedModel] = value
  }
  return result
}

export function getDefaultAppSettings(): AppSettings {
  return { ...DEFAULT_APP_SETTINGS }
}

const VALID_OCR_ENGINES = new Set<string>(['native_cuda', 'vision_model'])
const VALID_AUTO_INSTALL_POLICIES = new Set<string>(['disabled', 'prompt'])
const VALID_LANGUAGES = new Set<string>(['it', 'en'])
const VALID_OLLAMA_MODES = new Set<string>(['local', 'remote'])
const VALID_CAPABILITY_POLICY_MODES = new Set<string>(['offline-strict', 'local-only', 'network-approved'])

export function sanitizeAppSettings(input: unknown): AppSettings {
  if (!input || typeof input !== 'object') {
    return getDefaultAppSettings()
  }

  const raw = input as Record<string, unknown>
  const defaults = getDefaultAppSettings()

  // Legacy Plan countdown preferences are intentionally not migrated. Plan review now always
  // starts execution through an explicit action bound to one persisted revision.

  const ocrEngine =
    typeof raw.ocrEngine === 'string' && VALID_OCR_ENGINES.has(raw.ocrEngine) ? (raw.ocrEngine as 'native_cuda' | 'vision_model') : defaults.ocrEngine

  const autoInstallHubSkills =
    typeof raw.autoInstallHubSkills === 'string' && VALID_AUTO_INSTALL_POLICIES.has(raw.autoInstallHubSkills)
      ? (raw.autoInstallHubSkills as 'disabled' | 'prompt')
      : defaults.autoInstallHubSkills

  const language = typeof raw.language === 'string' && VALID_LANGUAGES.has(raw.language) ? (raw.language as 'it' | 'en') : defaults.language

  const ollamaMode = typeof raw.ollamaMode === 'string' && VALID_OLLAMA_MODES.has(raw.ollamaMode) ? (raw.ollamaMode as 'local' | 'remote') : defaults.ollamaMode

  const capabilityPolicyMode =
    typeof raw.capabilityPolicyMode === 'string' && VALID_CAPABILITY_POLICY_MODES.has(raw.capabilityPolicyMode)
      ? (raw.capabilityPolicyMode as NonNullable<AppSettings['capabilityPolicyMode']>)
      : defaults.capabilityPolicyMode

  const sanitized: AppSettings = {
    defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel.trim() : defaults.defaultModel,
    ocrEngine,
    ollamaHost: typeof raw.ollamaHost === 'string' && raw.ollamaHost.trim() ? raw.ollamaHost.trim() : defaults.ollamaHost,
    ollamaMode,
    capabilityPolicyMode,
    language,
    autoInstallHubSkills,
    autoInstallMinScore:
      typeof raw.autoInstallMinScore === 'number' && !isNaN(raw.autoInstallMinScore) ? raw.autoInstallMinScore : defaults.autoInstallMinScore,
    enableSkillRouter: typeof raw.enableSkillRouter === 'boolean' ? raw.enableSkillRouter : defaults.enableSkillRouter,
    maxToolCallSteps: normalizeAgentStepBudget(raw.maxToolCallSteps),
    enableCodingAgentDebugLog: typeof raw.enableCodingAgentDebugLog === 'boolean' ? raw.enableCodingAgentDebugLog : defaults.enableCodingAgentDebugLog,
    includeCodingAgentDebugPayloads:
      typeof raw.includeCodingAgentDebugPayloads === 'boolean' ? raw.includeCodingAgentDebugPayloads : defaults.includeCodingAgentDebugPayloads,
    codingAgentDebugRetentionFiles:
      typeof raw.codingAgentDebugRetentionFiles === 'number' && raw.codingAgentDebugRetentionFiles >= 1 && raw.codingAgentDebugRetentionFiles <= 5
        ? Math.floor(raw.codingAgentDebugRetentionFiles)
        : defaults.codingAgentDebugRetentionFiles,
    modelThinkingPreferences: sanitizeModelThinkingPreferences(raw.modelThinkingPreferences),
    hasCompletedInitialSetup: typeof raw.hasCompletedInitialSetup === 'boolean' ? raw.hasCompletedInitialSetup : defaults.hasCompletedInitialSetup,
    modelContextLengths: sanitizeModelContextLengths(raw.modelContextLengths),
  }

  // Optional string models
  const optionalStringKeys: (keyof AppSettings)[] = [
    'chatModel',
    'translationModel',
    'medicalModel',
    'legalModel',
    'codingModel',
    'visionModel',
    'embeddingModel',
    'customWorkspacePath',
    'translationOutputFolder',
  ]

  const sanitizedRecord = sanitized as unknown as Record<string, unknown>

  for (const key of optionalStringKeys) {
    if (typeof raw[key] === 'string') {
      const val = (raw[key] as string).trim()
      if (val) {
        sanitizedRecord[key] = val
      }
    }
  }

  // Optional booleans
  const optionalBoolKeys: (keyof AppSettings)[] = [
    'allowTerminalExecution',
    'allowFileModifications',
    'normalizeWithLlm',
    'noWorkspaceMode',
    'enableSoundEffects',
    'editorWordWrap',
    'verifyBeforeFinish',
    'enablePrePlanInterview',
  ]

  for (const key of optionalBoolKeys) {
    if (typeof raw[key] === 'boolean') {
      sanitizedRecord[key] = raw[key]
    }
  }

  if (
    typeof raw.agentSessionTimeoutMinutes === 'number' &&
    !isNaN(raw.agentSessionTimeoutMinutes) &&
    raw.agentSessionTimeoutMinutes >= 5 &&
    raw.agentSessionTimeoutMinutes <= 240
  ) {
    sanitized.agentSessionTimeoutMinutes = Math.floor(raw.agentSessionTimeoutMinutes)
  }

  // Prompt overrides are keyed by prompt node id.
  if (raw.customPromptOverrides && typeof raw.customPromptOverrides === 'object') {
    const overrides: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw.customPromptOverrides)) {
      if (typeof value === 'string' && PROMPT_NODE_IDS.includes(key as PromptNodeId)) {
        overrides[key] = value
      }
    }
    sanitized.customPromptOverrides = overrides
  }

  return sanitized
}

export function mergeAppSettings(current: AppSettings, updates: Partial<AppSettings>): AppSettings {
  return sanitizeAppSettings({ ...current, ...updates })
}
