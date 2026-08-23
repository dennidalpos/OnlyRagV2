import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import { compileSkillsContextBlock, type SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { AgentSession } from './agentOrchestratorAppService'
import { logger } from '../../diagnostics'
import { generateCompactRepoMap } from '../domain/agent/compactSemanticRepoMapper'
import {
  resolveWorkspacePath,
  buildDefaultAgentSettings,
  buildAttachedContextBlock,
  buildPinnedFilesContextBlock,
} from './agentOrchestratorSessionSetup'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { skillAppService } from './skillAppService'
import { skillInstallApprovalService, type SkillInstallCandidate } from './skillInstallApprovalService'
import { ollamaAppService } from './ollamaAppService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'

import type { AgentLogEntry } from '../domain/agent/agentTypes'

export type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

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
  modelCapabilities: Record<string, string[]>
  skillMatchContext: SkillMatchContext
  skillMatchingOptions: SkillMatchingOptions
  skillsBlock: string
}

async function scanProjectMap(workspacePath: string): Promise<string> {
  try {
    return generateCompactRepoMap(workspacePath, 150)
  } catch (err: any) {
    logger.log('WARN', 'AgentOrchestratorApp', `Project map scan failed: ${err.message}`)
    return ''
  }
}

/**
 * Resolves the task/workspace/settings for a run, scans the project map, warms up the
 * first-turn model without waiting for it, and runs skill matching (including the
 * 'prompt' auto-install confirmation round trip, awaited here since it happens while this
 * step assembles the turn prompt).
 */
export async function resolveSessionContext(params: SessionContextParams): Promise<SessionContext> {
  const { payload, session, sessionId, emitLog } = params

  const userTask = payload.userTask.trim()
  const agentMode = payload.agentMode || 'plan'
  const workspacePath = resolveWorkspacePath(payload)
  const isStandaloneMode = Boolean(payload.isStandaloneMode)
  const settings = payload.settings || buildDefaultAgentSettings()

  const attachedContext = buildAttachedContextBlock(payload)
  const pinnedFilesContextStr = buildPinnedFilesContextBlock(payload)

  const projectContextMapStr = workspacePath && !isStandaloneMode && documentIoRepository.exists(workspacePath)
    ? await scanProjectMap(workspacePath)
    : ''

  const availableModels = await ollamaAppService.getInstalledModels(settings.ollamaHost)
  // Native tool-calling capability map (see ollamaToolCallingCapability.ts). Fetched once
  // per session; failures resolve to an empty map, which falls back to the family allow-list.
  const modelCapabilities = await ollamaAppService.getModelCapabilities(settings.ollamaHost)

  const warmUpModel = settings.codingModel || settings.defaultModel || 'qwen2.5-coder:7b'

  emitLog(
    'info',
    `Task received: "${userTask}"`,
    `Mode: ${agentMode.toUpperCase()} | Engine: Clean Layered Architecture | Model: ${warmUpModel} | Workspace: ${workspacePath || 'Standalone'}`
  )

  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionStart(
      sessionId,
      userTask,
      agentMode,
      warmUpModel,
      workspacePath,
      settings.hardwareProfile
    )
  }

  void ollamaAppService.preloadModel(warmUpModel, settings.ollamaHost).catch(() => {})

  const skillMatchContext = {
    userTask,
    activeFilePath: payload.activeFile?.path,
    activeFileContent: payload.activeFile?.content,
    pinnedFiles: payload.pinnedFiles?.map((f) => ({ path: f.path, name: f.name })),
    workspacePath: workspacePath || undefined,
  }

  const skillMatchingOptions = {
    enableSkillRouter: settings.enableSkillRouter !== false && settings.autoInstallHubSkills !== 'disabled',
    autoInstallHubSkills: settings.autoInstallHubSkills,
    autoInstallMinScore: settings.autoInstallMinScore,
    onConfirmInstall: (candidate: SkillInstallCandidate) => {
      emitLog('info', `🧩 Skill Hub: richiesta conferma installazione '${candidate.skillName}' da ${candidate.hubName} (score ${candidate.score.toFixed(1)})`)
      return skillInstallApprovalService.requestApproval(session.targetWindow, candidate)
    },
  }

  const matchedSkills = await skillAppService.getMatchedSkills(skillMatchContext, workspacePath, 3, skillMatchingOptions)
  let skillsBlock = ''
  if (matchedSkills.length > 0) {
    const skillNames = matchedSkills.map((s) => s.name)
    if (session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:skills-matched', { skills: skillNames })
    }
    emitLog('info', `✨ Skill Router: Attivate ${matchedSkills.length} skill [${skillNames.join(', ')}]`)
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSkillsMatched(sessionId, skillNames)
    }
    skillsBlock = compileSkillsContextBlock(matchedSkills)
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
    modelCapabilities,
    skillMatchContext,
    skillMatchingOptions,
    skillsBlock,
  }
}
