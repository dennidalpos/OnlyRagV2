import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import type { GuestOsInfo, OllamaModelMetrics } from '../../../shared/types'
import { supportsNativeToolCalling } from '../../../shared/domain/agent/ollamaToolCallingCapability'
import { noConfiguredModelMessage } from '../../../shared/domain/settings/configuredModel'
import { validateWorkspaceRealpath } from '../infrastructure/filesystem/workspaceRealpathGuard'
import { findCodingModelEvidence } from '../../../shared/domain/agent/codingModelQualification'

const MIN_AGENT_CONTEXT_TOKENS = 4096

export interface AgentCodingPreflightInput {
  codingModel: string
  availableModels: readonly string[]
  modelMetrics: Record<string, OllamaModelMetrics>
  effectiveContextTokens: number
  ollamaReachable: boolean
  ollamaError?: string
  workspacePath: string | null
  sourceWorkspacePath?: string | null
  isStandaloneMode: boolean
  toolchain: GuestOsInfo['tools']
}

export interface AgentCodingPreflightCheck {
  id: 'ollama' | 'model' | 'tools' | 'probes' | 'qualification' | 'context' | 'workspace' | 'trust' | 'toolchain'
  passed: boolean
  blocking: boolean
  detail: string
}

export interface AgentCodingPreflightResult {
  ready: boolean
  checks: AgentCodingPreflightCheck[]
}

function canWriteWorkspace(workspacePath: string | null): boolean {
  return workspacePath ? documentIoRepository.isWritable(workspacePath) : false
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
  const nativeTools = modelInstalled && supportsNativeToolCalling(input.codingModel, { [input.codingModel]: metric?.capabilities || [] })
  const evidence = findCodingModelEvidence(input.codingModel)
  const contextValid =
    Number.isInteger(input.effectiveContextTokens) &&
    input.effectiveContextTokens >= MIN_AGENT_CONTEXT_TOKENS &&
    typeof metric?.contextLength === 'number' &&
    Number.isFinite(metric.contextLength) &&
    input.effectiveContextTokens <= metric.contextLength
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
      detail: modelInstalled
        ? `Installed model: ${input.codingModel}.`
        : input.codingModel
          ? `Configured model is not installed: ${input.codingModel}.`
          : noConfiguredModelMessage('coding'),
    },
    {
      id: 'tools',
      passed: nativeTools,
      blocking: true,
      detail: nativeTools ? 'Native tool calling is available; task quality is evaluated separately.' : 'Native tool calling is unavailable.',
    },
    {
      id: 'probes',
      passed: Boolean(evidence),
      blocking: false,
      detail: evidence
        ? `Historical focused probes (${evidence.date}; ${evidence.probes.join(', ')}): ${evidence.outcome}`
        : 'No focused live probe evidence is recorded for this model.',
    },
    {
      id: 'qualification',
      passed: false,
      blocking: false,
      detail: 'Autonomous coding is experimental and unqualified: complete independent full-task acceptance is missing.',
    },
    {
      id: 'context',
      passed: contextValid,
      blocking: true,
      detail: `Effective run context: ${input.effectiveContextTokens} tokens; model capacity: ${metric?.contextLength ?? 'unknown'}; minimum runtime requirement: ${MIN_AGENT_CONTEXT_TOKENS}. This is not a full-task quality threshold.`,
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
