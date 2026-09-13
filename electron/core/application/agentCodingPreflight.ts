import fs from 'node:fs'
import type { GuestOsInfo, OllamaModelMetrics } from '../../../shared/types'
import { supportsNativeToolCalling } from '../../../shared/domain/agent/ollamaToolCallingCapability'
import { validateWorkspaceRealpath } from '../infrastructure/filesystem/workspaceRealpathGuard'

const MIN_AGENT_CONTEXT_TOKENS = 4096

export interface AgentCodingPreflightInput {
  codingModel: string
  availableModels: readonly string[]
  modelMetrics: Record<string, OllamaModelMetrics>
  ollamaReachable: boolean
  ollamaError?: string
  workspacePath: string | null
  sourceWorkspacePath?: string | null
  isStandaloneMode: boolean
  toolchain: GuestOsInfo['tools']
}

export interface AgentCodingPreflightCheck {
  id: 'ollama' | 'model' | 'qualification' | 'context' | 'workspace' | 'trust' | 'toolchain'
  passed: boolean
  blocking: boolean
  detail: string
}

export interface AgentCodingPreflightResult {
  ready: boolean
  checks: AgentCodingPreflightCheck[]
}

function canWriteWorkspace(workspacePath: string | null): boolean {
  if (!workspacePath) return false
  try {
    fs.accessSync(workspacePath, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function hasTrustedWorkspace(input: AgentCodingPreflightInput): boolean {
  if (!input.workspacePath) return false
  const executionCheck = validateWorkspaceRealpath(input.workspacePath, input.workspacePath)
  if (!executionCheck.safePath) return false
  if (input.isStandaloneMode) return true

  const sourcePath = input.sourceWorkspacePath || input.workspacePath
  return Boolean(validateWorkspaceRealpath(sourcePath, sourcePath).safePath)
}

/** Validates the runtime facts that must hold before an Agent Coding turn can start. */
export function evaluateAgentCodingPreflight(input: AgentCodingPreflightInput): AgentCodingPreflightResult {
  const metric = input.modelMetrics[input.codingModel]
  const modelInstalled = input.availableModels.includes(input.codingModel)
  const toolsAvailable = Object.entries(input.toolchain)
    .filter(([, available]) => !available)
    .map(([tool]) => tool)

  const checks: AgentCodingPreflightCheck[] = [
    {
      id: 'ollama',
      passed: input.ollamaReachable,
      blocking: true,
      detail: input.ollamaReachable ? 'Ollama is reachable.' : input.ollamaError || 'Ollama is not reachable.',
    },
    {
      id: 'model',
      passed: modelInstalled,
      blocking: true,
      detail: modelInstalled ? `Installed model: ${input.codingModel}.` : `Configured model is not installed: ${input.codingModel}.`,
    },
    {
      id: 'qualification',
      passed: modelInstalled && supportsNativeToolCalling(input.codingModel, { [input.codingModel]: metric?.capabilities || [] }),
      blocking: true,
      detail: modelInstalled && supportsNativeToolCalling(input.codingModel, { [input.codingModel]: metric?.capabilities || [] })
        ? 'Model supports Agent Coding tool calls.'
        : 'Model does not qualify for Agent Coding tool calls.',
    },
    {
      id: 'context',
      passed: typeof metric?.contextLength === 'number' && metric.contextLength >= MIN_AGENT_CONTEXT_TOKENS,
      blocking: true,
      detail: typeof metric?.contextLength === 'number'
        ? `Model context: ${metric.contextLength} tokens.`
        : 'Model context capacity is unavailable from Ollama.',
    },
    {
      id: 'workspace',
      passed: canWriteWorkspace(input.workspacePath),
      blocking: true,
      detail: canWriteWorkspace(input.workspacePath) ? 'Workspace is writable.' : 'Workspace is not writable.',
    },
    {
      id: 'trust',
      passed: hasTrustedWorkspace(input),
      blocking: true,
      detail: hasTrustedWorkspace(input) ? 'Workspace path is bound and confined.' : 'Workspace path failed confinement validation.',
    },
    {
      id: 'toolchain',
      passed: toolsAvailable.length === 0,
      blocking: false,
      detail: toolsAvailable.length === 0 ? 'Configured toolchain is available.' : `Unavailable tools: ${toolsAvailable.join(', ')}.`,
    },
  ]

  return { ready: checks.every((check) => !check.blocking || check.passed), checks }
}
