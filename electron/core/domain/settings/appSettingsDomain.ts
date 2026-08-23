import type { AppSettings, HardwareProfile } from '../../../../src/types'
import { PROMPT_NODE_IDS, type PromptNodeId } from '../agent/promptHierarchyRegistry'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultModel: '',
  hardwareProfile: 'Auto',
  ocrEngine: 'native_cuda',
  ollamaHost: 'http://127.0.0.1:11434',
  ollamaMode: 'local',
  language: 'it',
  autoInstallHubSkills: 'auto',
  autoInstallMinScore: 8.0,
  enableSkillRouter: true,
  maxToolCallSteps: 50,
  enableCodingAgentDebugLog: true,
  hasCompletedInitialSetup: false,
}

export function getDefaultAppSettings(): AppSettings {
  return { ...DEFAULT_APP_SETTINGS }
}

const VALID_HARDWARE_PROFILES = new Set<string>(['Auto', 'Legacy', 'Entry', 'MidRange', 'HighEnd', 'Extreme'])
const VALID_OCR_ENGINES = new Set<string>(['native_cuda', 'vision_model'])
const VALID_AUTO_INSTALL_POLICIES = new Set<string>(['disabled', 'prompt', 'auto'])
const VALID_LANGUAGES = new Set<string>(['it', 'en'])
const VALID_OLLAMA_MODES = new Set<string>(['local', 'remote'])

export function sanitizeAppSettings(input: unknown): AppSettings {
  if (!input || typeof input !== 'object') {
    return getDefaultAppSettings()
  }

  const raw = input as Record<string, any>
  const defaults = getDefaultAppSettings()

  const hardwareProfile: HardwareProfile =
    typeof raw.hardwareProfile === 'string' && VALID_HARDWARE_PROFILES.has(raw.hardwareProfile)
      ? (raw.hardwareProfile as HardwareProfile)
      : defaults.hardwareProfile

  const ocrEngine =
    typeof raw.ocrEngine === 'string' && VALID_OCR_ENGINES.has(raw.ocrEngine)
      ? (raw.ocrEngine as 'native_cuda' | 'vision_model')
      : defaults.ocrEngine

  const autoInstallHubSkills =
    typeof raw.autoInstallHubSkills === 'string' && VALID_AUTO_INSTALL_POLICIES.has(raw.autoInstallHubSkills)
      ? (raw.autoInstallHubSkills as 'disabled' | 'prompt' | 'auto')
      : defaults.autoInstallHubSkills

  const language =
    typeof raw.language === 'string' && VALID_LANGUAGES.has(raw.language)
      ? (raw.language as 'it' | 'en')
      : defaults.language

  const ollamaMode =
    typeof raw.ollamaMode === 'string' && VALID_OLLAMA_MODES.has(raw.ollamaMode)
      ? (raw.ollamaMode as 'local' | 'remote')
      : defaults.ollamaMode

  const sanitized: AppSettings = {
    defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel.trim() : defaults.defaultModel,
    hardwareProfile,
    ocrEngine,
    ollamaHost: typeof raw.ollamaHost === 'string' && raw.ollamaHost.trim() ? raw.ollamaHost.trim() : defaults.ollamaHost,
    ollamaMode,
    language,
    autoInstallHubSkills,
    autoInstallMinScore: typeof raw.autoInstallMinScore === 'number' && !isNaN(raw.autoInstallMinScore) ? raw.autoInstallMinScore : defaults.autoInstallMinScore,
    enableSkillRouter: typeof raw.enableSkillRouter === 'boolean' ? raw.enableSkillRouter : defaults.enableSkillRouter,
    maxToolCallSteps: typeof raw.maxToolCallSteps === 'number' && raw.maxToolCallSteps >= 5 && raw.maxToolCallSteps <= 500 ? raw.maxToolCallSteps : defaults.maxToolCallSteps,
    enableCodingAgentDebugLog: typeof raw.enableCodingAgentDebugLog === 'boolean' ? raw.enableCodingAgentDebugLog : defaults.enableCodingAgentDebugLog,
    hasCompletedInitialSetup: typeof raw.hasCompletedInitialSetup === 'boolean' ? raw.hasCompletedInitialSetup : defaults.hasCompletedInitialSetup,
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
    'enableSystemRamOffloading',
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
