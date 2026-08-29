import type { AppSettings } from '../../../../shared/types'
import { PROMPT_NODE_IDS, type PromptNodeId } from '../agent/promptHierarchyRegistry'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultModel: '',
  ocrEngine: 'native_cuda',
  ollamaHost: 'http://127.0.0.1:11434',
  ollamaMode: 'local',
  language: 'it',
  autoInstallHubSkills: 'disabled',
  autoInstallMinScore: 8.0,
  enableSkillRouter: true,
  maxToolCallSteps: 0,
  enableCodingAgentDebugLog: true,
  hasCompletedInitialSetup: false,
}

export const MIN_MODEL_CONTEXT_LENGTH = 4096

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

  const raw = input as Record<string, any>
  const defaults = getDefaultAppSettings()

  const ocrEngine =
    typeof raw.ocrEngine === 'string' && VALID_OCR_ENGINES.has(raw.ocrEngine)
      ? (raw.ocrEngine as 'native_cuda' | 'vision_model')
      : defaults.ocrEngine

  const autoInstallHubSkills =
    typeof raw.autoInstallHubSkills === 'string' && VALID_AUTO_INSTALL_POLICIES.has(raw.autoInstallHubSkills)
      ? (raw.autoInstallHubSkills as 'disabled' | 'prompt')
      : defaults.autoInstallHubSkills

  const language =
    typeof raw.language === 'string' && VALID_LANGUAGES.has(raw.language)
      ? (raw.language as 'it' | 'en')
      : defaults.language

  const ollamaMode =
    typeof raw.ollamaMode === 'string' && VALID_OLLAMA_MODES.has(raw.ollamaMode)
      ? (raw.ollamaMode as 'local' | 'remote')
      : defaults.ollamaMode

  const capabilityPolicyMode =
    typeof raw.capabilityPolicyMode === 'string' && VALID_CAPABILITY_POLICY_MODES.has(raw.capabilityPolicyMode)
      ? (raw.capabilityPolicyMode as NonNullable<AppSettings['capabilityPolicyMode']>)
      : undefined

  const sanitized: AppSettings = {
    defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel.trim() : defaults.defaultModel,
    ocrEngine,
    ollamaHost: typeof raw.ollamaHost === 'string' && raw.ollamaHost.trim() ? raw.ollamaHost.trim() : defaults.ollamaHost,
    ollamaMode,
    capabilityPolicyMode,
    language,
    autoInstallHubSkills,
    autoInstallMinScore: typeof raw.autoInstallMinScore === 'number' && !isNaN(raw.autoInstallMinScore) ? raw.autoInstallMinScore : defaults.autoInstallMinScore,
    enableSkillRouter: typeof raw.enableSkillRouter === 'boolean' ? raw.enableSkillRouter : defaults.enableSkillRouter,
    maxToolCallSteps: typeof raw.maxToolCallSteps === 'number' && (raw.maxToolCallSteps === 0 || (raw.maxToolCallSteps >= 5 && raw.maxToolCallSteps <= 500)) ? raw.maxToolCallSteps : defaults.maxToolCallSteps,
    enableCodingAgentDebugLog: typeof raw.enableCodingAgentDebugLog === 'boolean' ? raw.enableCodingAgentDebugLog : defaults.enableCodingAgentDebugLog,
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
    'codingFallbackModel',
    'visionModel',
    'visionFallbackModel',
    'embeddingModel',
    'chatFallbackModel',
    'translationFallbackModel',
    'medicalFallbackModel',
    'legalFallbackModel',
    'customWorkspacePath',
    'translationOutputFolder',
  ]

  for (const key of optionalStringKeys) {
    if (typeof raw[key] === 'string') {
      const val = (raw[key] as string).trim()
      if (val) {
        ;(sanitized as any)[key] = val
      }
    }
  }

  // Optional booleans
  const optionalBoolKeys: (keyof AppSettings)[] = [
    'allowTerminalExecution',
    'allowFileModifications',
    'normalizeWithLlm',
    'noWorkspaceMode',
    'requirePlanApproval',
    'autoProceedPlan',
    'enableSoundEffects',
    'editorWordWrap',
  ]

  for (const key of optionalBoolKeys) {
    if (typeof raw[key] === 'boolean') {
      ;(sanitized as any)[key] = raw[key]
    }
  }

  // Optional numbers
  if (typeof raw.autoProceedDelaySeconds === 'number' && !isNaN(raw.autoProceedDelaySeconds)) {
    sanitized.autoProceedDelaySeconds = raw.autoProceedDelaySeconds
  }

  // Prompt overrides are keyed by prompt node id. Anything else is a leftover from the retired
  // per-model-family scheme ('chat:qwen', 'vision', ...) and is dropped rather than migrated:
  // those keys addressed prompts that no longer exist.
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
