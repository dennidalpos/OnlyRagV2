import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../shared/types'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillDefinition } from '../domain/skills/skillTypes'
import type { SkillMatchingOptions } from './skillAppService'
import type { AgentSession } from './agentOrchestratorTypes'
import { completeInterruptedBatch } from './agentChatTranscript'
import { logger } from '../infrastructure/logging/logger'
import { generateCompactRepoMap } from '../infrastructure/filesystem/compactSemanticRepoMapper'
import { resolveWorkspacePath, buildDefaultAgentSettings, buildAttachedContextBlock, buildPinnedFilesContextBlock } from './agentOrchestratorSessionSetup'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { skillAppService } from './skillAppService'
import { skillInstallApprovalService, type SkillInstallCandidate } from './skillInstallApprovalService'
import { ollamaAppService } from './ollamaAppService'
import type { OllamaModelMetrics } from '../infrastructure/http/ollamaHttpClient'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { findMatchingInstalledModel } from '../../../shared/domain/agent/modelTagMatcher'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { validateRestoredOllamaRuntime } from '../domain/agent/ollamaSessionRuntime'
import { applyAgentCapabilityProfile } from '../../../shared/domain/agent/agentCapabilityProfile'
import { isCodingAgentDebugPayloadCaptureEnabled } from '../../../shared/domain/agent/codingAgentDebugPolicy'

import type { EmitLog } from './agentOrchestratorTypes'
import { resolveConfiguredModel } from '../../../shared/domain/settings/configuredModel'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

export interface SessionContextParams {
  payload: AgentTaskPayload
  session: AgentSession
  sessionId: string
  emitLog: EmitLog
}

/** Resolved task/workspace/settings and the context blocks assembled once per session. */
export interface SessionContext {
  userTask: string
  agentMode: AgentExecutionMode
  workspacePath: string | null
  isStandaloneMode: boolean
  settings: AppSettings
  attachedContext: string
  pinnedFilesContextStr: string
  projectContextMapStr: string
  availableModels: string[]
  /** Exact coding model pinned for this execution. */
  codingModel: string
  modelCapabilities: Record<string, string[]>
  /** The per-model facts Ollama reports on `/api/tags`, keyed by model tag. */
  modelMetrics: Record<string, OllamaModelMetrics>
  skillMatchContext: SkillMatchContext
  skillMatchingOptions: SkillMatchingOptions
  /** Skills matched at session start; each turn injects the ones that still fit the workspace manifest. */
  matchedSkills: SkillDefinition[]
  /** Non-null when a resumed run cannot safely reproduce its pinned runtime. */
  resumeValidationError: string | null
}

async function scanProjectMap(workspacePath: string): Promise<string> {
  try {
    return generateCompactRepoMap(workspacePath, 150)
  } catch (err: unknown) {
    logger.log('WARN', 'AgentOrchestratorApp', `Project map scan failed: ${errorMessage(err)}`)
    return ''
  }
}

/** Resolves the task/workspace/settings for a run, scans the project map, warms up the first-turn model without waiting for it, and runs skill matching (including the 'prompt' auto-install confirmation round trip, awaited here since it happens while this step ass */
export async function resolveSessionContext(params: SessionContextParams): Promise<SessionContext> {
  const { payload, session, sessionId, emitLog } = params

  const userTask = payload.userTask.trim()
  const agentMode = payload.agentMode || 'guided'
  const workspacePath = resolveWorkspacePath(payload)
  const isStandaloneMode = Boolean(payload.isStandaloneMode)
  const settings = payload.capabilityProfile
    ? applyAgentCapabilityProfile(payload.settings || buildDefaultAgentSettings(), payload.capabilityProfile)
    : payload.settings || buildDefaultAgentSettings()

  const attachedContext = buildAttachedContextBlock(payload)
  const pinnedFilesContextStr = buildPinnedFilesContextBlock(payload)

  const projectContextMapStr = workspacePath && !isStandaloneMode && documentIoRepository.exists(workspacePath) ? await scanProjectMap(workspacePath) : ''

  const availableModels = await ollamaAppService.getInstalledModels(settings.ollamaHost)
  const savedState = await agentSessionStateRepository.loadSessionState(sessionId, workspacePath)
  if (savedState?.ollamaRuntimeProfile) session.ollamaRuntimeProfile = savedState.ollamaRuntimeProfile
  session.ollamaGenerationTelemetry = savedState?.ollamaGenerationTelemetry || []
  session.lastVerification = savedState?.lastVerification
  session.chatMessages = completeInterruptedBatch(savedState?.chatMessages || [])
  // '' when no model is configured: the preflight then blocks the run with a clear message.
  const requestedCodingModel = resolveConfiguredModel('coding', settings, payload.activeModel)
  const codingModel = session.ollamaRuntimeProfile?.model || findMatchingInstalledModel(requestedCodingModel, availableModels) || requestedCodingModel
  // One `/api/tags` read, both facts.
  const modelMetrics = await ollamaAppService.getModelMetrics(settings.ollamaHost)
  const modelCapabilities: Record<string, string[]> = Object.fromEntries(Object.entries(modelMetrics).map(([name, metrics]) => [name, metrics.capabilities]))
  const resumeValidationError = session.ollamaRuntimeProfile
    ? validateRestoredOllamaRuntime(session.ollamaRuntimeProfile, settings.ollamaHost, availableModels, modelMetrics)
    : null

  emitLog(
    'info',
    `Task received: "${userTask}"`,
    `Mode: ${agentMode.toUpperCase()} | Engine: Clean Layered Architecture | Model: ${codingModel} | Workspace: ${workspacePath || 'Standalone'}`,
  )

  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.configureRetention(settings.codingAgentDebugRetentionFiles || 2)
    codingAgentLogger.logSessionStart(sessionId, userTask, agentMode, codingModel, workspacePath, isCodingAgentDebugPayloadCaptureEnabled(settings))
  }

  const skillMatchContext = {
    userTask,
    activeFilePath: payload.activeFile?.path,
    activeFileContent: payload.activeFile?.content,
    pinnedFiles: payload.pinnedFiles?.map((f) => ({ path: f.path, name: f.name })),
    workspacePath: workspacePath || undefined,
  }

  const skillMatchingOptions = {
    enableSkillRouter: settings.enableSkillRouter === true,
    autoInstallHubSkills: settings.autoInstallHubSkills,
    autoInstallMinScore: settings.autoInstallMinScore,
    onConfirmInstall: (candidate: SkillInstallCandidate) => {
      emitLog('info', `🧩 Skill Hub: richiesta conferma installazione '${candidate.skillName}' da ${candidate.hubName} (score ${candidate.score.toFixed(1)})`)
      return skillInstallApprovalService.requestApproval(session.rendererEvents, candidate, session.identity)
    },
  }

  const matchedSkills = await skillAppService.getMatchedSkills(skillMatchContext, workspacePath, 3, skillMatchingOptions)
  if (matchedSkills.length > 0) {
    const skillNames = matchedSkills.map((s) => s.name)
    if (session.rendererEvents?.isAvailable()) {
      session.rendererEvents.send('agent:skills-matched', { ...session.identity, skills: skillNames })
    }
    emitLog('info', `✨ Skill Router: Attivate ${matchedSkills.length} skill [${skillNames.join(', ')}]`)
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSkillsMatched(sessionId, skillNames)
    }
  }

  return {
    userTask,
    agentMode,
    workspacePath,
    isStandaloneMode,
    settings,
    attachedContext,
    pinnedFilesContextStr,
    projectContextMapStr,
    availableModels,
    codingModel,
    modelCapabilities,
    modelMetrics,
    skillMatchContext,
    skillMatchingOptions,
    matchedSkills,
    resumeValidationError,
  }
}
