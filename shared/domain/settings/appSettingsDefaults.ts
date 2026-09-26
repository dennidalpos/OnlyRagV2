import type { AppSettings } from '../../types'
import { DEFAULT_AGENT_STEP_BUDGET } from '../agent/agentStepBudget'
import { DEFAULT_OLLAMA_HOST } from '../ollamaHost'

/**
 * Canonical defaults for renderer and main alike: fail-closed tools, and a network policy that asks
 * before every network action (installs, web research, downloads) rather than refusing them, since a
 * coding agent cannot install a project's dependencies otherwise.
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultModel: '',
  ocrEngine: 'native_cuda',
  ollamaHost: DEFAULT_OLLAMA_HOST,
  ollamaMode: 'local',
  language: 'it',
  autoInstallHubSkills: 'disabled',
  autoInstallMinScore: 8.0,
  enableSkillRouter: false,
  allowFileModifications: false,
  allowTerminalExecution: false,
  capabilityPolicyMode: 'network-approved',
  maxToolCallSteps: DEFAULT_AGENT_STEP_BUDGET,
  enableCodingAgentDebugLog: false,
  includeCodingAgentDebugPayloads: false,
  codingAgentDebugRetentionFiles: 2,
  modelThinkingPreferences: {},
  hasCompletedInitialSetup: false,
}
