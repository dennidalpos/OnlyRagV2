import { BrowserWindow } from 'electron'
import http from 'node:http'
import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import type { AgentTaskPayload, AgentTaskResult, AgentToolCall } from '../domain/agent/agentTypes'
import { evaluateTaskComplexity } from '../domain/agent/complexityEvaluator'
import os from 'node:os'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { AgentPromptAssembler } from '../domain/agent/agentPromptAssembler'
import { HeuristicContextCompactor } from '../domain/agent/heuristicContextCompactor'
import { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import { calculateDynamicContextWindow } from '../domain/agent/contextWindowCalculator'
import { AgentStreamTransport } from '../infrastructure/http/agentStreamTransport'
import { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import { TransactionalExecutionGuard } from '../domain/agent/transactionalExecutionGuard'
import { CompactSemanticRepoMapper } from '../domain/agent/compactSemanticRepoMapper'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import { supportsNativeToolCalling } from '../domain/agent/ollamaToolCallingCapability'
import { resolveOllamaContextReuse } from '../domain/agent/ollamaContextCacheManager'
import { OLLAMA_TOOL_SCHEMA_CATALOG } from '../domain/agent/ollamaToolSchemaCatalog'
import { handleUpdatePlanTool } from './agentOrchestratorPlanTool'
import { runToolGates } from './agentOrchestratorToolGates'
import { runToolResultProcessing } from './agentOrchestratorToolResultProcessor'
import { interpretTurnResponse, type ResponseInterpreterState } from './agentOrchestratorResponseInterpreter'
import {
  resolveWorkspacePath,
  buildDefaultAgentSettings,
  buildAttachedContextBlock,
  buildPinnedFilesContextBlock,
} from './agentOrchestratorSessionSetup'
import { ResilientModelDispatcher } from './resilientModelDispatcher'
import { agentToolExecutorService } from './agentToolExecutorService'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { skillAppService } from './skillAppService'
import { skillInstallApprovalService, type SkillInstallCandidate } from './skillInstallApprovalService'
import { ollamaAppService } from './ollamaAppService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { PlanManager } from '../domain/agent/planManager'
import type { AppSettings } from '../../../src/types'

export interface ApprovalResponse {
  approved: boolean
  /** Indices (into groupDiffIntoHunks' result) of the hunks the user approved, for a partial (not all-or-nothing) file-mutation approval. */
  approvedHunkIndices?: number[]
}

interface AgentSession {
  id: string
  isCancelled: boolean
  targetWindow: BrowserWindow | null
  activeHttpRequest?: http.ClientRequest | null
  activeChildProcess?: any | null
  /** Global session watchdog. Cleared on every exit path so it can never outlive its own run. */
  timeoutHandle?: NodeJS.Timeout | null
  /**
   * Ollama `context` continuation cache (AGT1): the token array + the exact
   * stable/history baseline it corresponds to, so the next turn can detect
   * whether a tail-append delta can be sent instead of the full prompt. See
   * ollamaContextCacheManager.ts. Scoped to this single agent run — cleared
   * implicitly whenever a new AgentSession is created.
   */
  ollamaContextTokens?: number[]
  ollamaContextModel?: string
  ollamaContextStableSection?: string
  ollamaContextHistoryBlock?: string
  /**
   * Set while the loop is paused inside an approval gate (see `requestApproval` in
   * runAgentOrchestratorLoop), so an in-flight `agent:approval-response` and a
   * cancellation/timeout racing against it both resolve the same pending Promise exactly
   * once instead of leaving the paused `while` loop blocked forever.
   */
  pendingApprovalResolve?: (response: ApprovalResponse) => void
}

const activeAgentSessions = new Map<string, AgentSession>()

function cleanupSession(session: AgentSession) {
  session.isCancelled = true
  // A step paused inside requestApproval() must not block forever just because the task was
  // cancelled instead of answered: resolving false lets the awaited Promise settle, the
  // paused `while` loop observe isCancelled on its next check, and exit cleanly.
  if (session.pendingApprovalResolve) {
    session.pendingApprovalResolve({ approved: false })
    session.pendingApprovalResolve = undefined
  }
  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle)
    session.timeoutHandle = null
  }
  if (session.activeHttpRequest) {
    try {
      session.activeHttpRequest.destroy()
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestrator', `Failed destroying active HTTP request during cleanup: ${err?.message}`)
    }
    session.activeHttpRequest = null
  }
  if (session.activeChildProcess) {
    try {
      if (process.platform === 'win32' && session.activeChildProcess.pid) {
        taskRunner.killProcessTreeWindows(session.activeChildProcess.pid)
      } else {
        session.activeChildProcess.kill('SIGKILL')
      }
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestrator', `Failed terminating child process during cleanup: ${err?.message}`)
    }
    session.activeChildProcess = null
  }
  try {
    agentToolExecutorService.rollbackJournal()
  } catch (err: any) {
    logger.log('WARN', 'AgentOrchestrator', `Failed rolling back journal during cleanup: ${err?.message}`)
  }
  if (session.targetWindow && !session.targetWindow.isDestroyed()) {
    session.targetWindow.webContents.send('agent:log', {
      id: `${Date.now()}-cancelled`,
      timestamp: new Date().toISOString(),
      type: 'info',
      message: "Task interrotto dall'utente.",
    })
    session.targetWindow.webContents.send('agent:done', { success: false, summary: "Task interrotto dall'utente." })
  }
}

export function cancelActiveAgentTask(targetSessionId?: string) {
  if (targetSessionId) {
    const session = activeAgentSessions.get(targetSessionId)
    if (session) {
      cleanupSession(session)
      activeAgentSessions.delete(targetSessionId)
      logger.log('INFO', 'AgentOrchestratorApp', `Agent session ${targetSessionId} cancelled by user.`)
    }
  } else {
    for (const [id, session] of activeAgentSessions.entries()) {
      cleanupSession(session)
      activeAgentSessions.delete(id)
    }
    logger.log('INFO', 'AgentOrchestratorApp', `All active agent sessions cancelled by user.`)
  }
}

/**
 * Answers a step paused inside requestApproval(). Returns false if the session is no longer
 * active or isn't currently waiting on an approval (e.g. the response arrived after a
 * cancellation or the session timeout already resolved it), so the renderer can tell a
 * genuine hand-off from a stale response.
 */
export function respondToApproval(targetSessionId: string, approved: boolean, approvedHunkIndices?: number[]): boolean {
  const session = activeAgentSessions.get(targetSessionId)
  if (!session || !session.pendingApprovalResolve) return false
  const resolve = session.pendingApprovalResolve
  session.pendingApprovalResolve = undefined
  resolve({ approved, approvedHunkIndices })
  return true
}

async function scanProjectMap(workspacePath: string): Promise<string> {
  try {
    return CompactSemanticRepoMapper.generateCompactRepoMap(workspacePath, 150)
  } catch (err: any) {
    logger.log('WARN', 'AgentOrchestratorApp', `Project map scan failed: ${err.message}`)
    return ''
  }
}

export async function runAgentOrchestratorLoop(
  payload: AgentTaskPayload,
  win: BrowserWindow | null,
  customSessionId?: string
): Promise<AgentTaskResult> {
  if (!payload.userTask || !payload.userTask.trim()) {
    return { success: false, summary: 'Task prompt empty', error: 'Task prompt is required' }
  }

  const sessionId = payload.sessionId || customSessionId || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  const session: AgentSession = {
    id: sessionId,
    isCancelled: false,
    targetWindow: win,
    activeHttpRequest: null,
    activeChildProcess: null,
  }
  activeAgentSessions.set(sessionId, session)

  // Compares by identity, not just by key presence: if a later run registers under the same
  // reused sessionId, this run must recognise that it is no longer the owner and stand down.
  const isSessionActive = () => activeAgentSessions.get(sessionId) === session && !session.isCancelled

  const emitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:log', {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        type,
        message,
        detail,
      })
    }
  }

  const emitDone = (success: boolean, summary: string) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:done', { success, summary })
    }
  }

  const userTask = payload.userTask.trim()
  const agentMode = payload.agentMode || 'plan'
  let workspacePath = resolveWorkspacePath(payload)
  const isStandaloneMode = Boolean(payload.isStandaloneMode)
  const settings: AppSettings = payload.settings || buildDefaultAgentSettings()

  const attachedContext = buildAttachedContextBlock(payload)
  const pinnedFilesContextStr = buildPinnedFilesContextBlock(payload)

  const projectContextMapStr = workspacePath && !isStandaloneMode && documentIoRepository.exists(workspacePath)
    ? await scanProjectMap(workspacePath)
    : ''

  emitLog(
    'info',
    `Task received: "${userTask}"`,
    `Mode: ${agentMode.toUpperCase()} | Engine: Clean Layered Architecture | Workspace: ${workspacePath || 'Standalone'}`
  )

  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionStart(sessionId, userTask, agentMode, settings.codingModel || settings.defaultModel || 'llama3.2', workspacePath)
  }

  const availableModels = await ollamaAppService.getInstalledModels(settings.ollamaHost)
  // Native tool-calling capability map (see ollamaToolCallingCapability.ts). Fetched once
  // per session; failures resolve to an empty map, which falls back to the family allow-list.
  const modelCapabilities = await ollamaAppService.getModelCapabilities(settings.ollamaHost)

  // Warm-up: start loading the model the first turn will most likely use, without waiting
  // for it. The load then overlaps with skill matching and prompt assembly below instead of
  // running down the first turn's 45s initial-response timeout on a cold, CPU-only machine.
  const firstTurnComplexity = evaluateTaskComplexity(userTask, {
    attachedFilesCount: payload.pinnedFiles?.length || 0,
    contextSizeChars: payload.activeFile?.content?.length || 0,
    settings,
    availableModels,
    hasRecentToolFailure: false,
    errorCountInHistory: 0,
  })
  const warmUpModel = settings.useComplexityRouting
    ? firstTurnComplexity.modelName
    : settings.codingModel || settings.defaultModel || 'llama3.2'
  void ollamaAppService.preloadModel(warmUpModel, settings.ollamaHost).catch(() => {})

  const skillMatchContext = {
    userTask,
    activeFilePath: payload.activeFile?.path,
    activeFileContent: payload.activeFile?.content,
    pinnedFiles: payload.pinnedFiles?.map((f) => ({ path: f.path, name: f.name })),
    workspacePath: workspacePath || undefined,
  }

  // In 'prompt' mode the auto-install of a hub skill is submitted to the user and awaited
  // here, because the decision happens while this loop assembles the turn prompt.
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
  if (matchedSkills.length > 0) {
    const skillNames = matchedSkills.map((s) => s.name)
    if (session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:skills-matched', { skills: skillNames })
    }
    emitLog('info', `✨ Skill Router: Attivate ${matchedSkills.length} skill [${skillNames.join(', ')}]`)
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSkillsMatched(sessionId, skillNames)
    }
  }

  const episodicCompactor = new EpisodicMemoryCompactor(6)
  const goalPlanner = new GoalDecompositionPlanner()
  const fsmMode = new AgentRuntimeModeFsm(agentMode)
  const isUnlimitedSteps = settings.maxToolCallSteps === 0 || (settings.maxToolCallSteps !== undefined && settings.maxToolCallSteps >= 200)
  const MAX_STEPS = isUnlimitedSteps ? Infinity : Math.max(10, Math.min(200, settings.maxToolCallSteps || 50))
  const maxStepsLabel = MAX_STEPS === Infinity ? '∞' : String(MAX_STEPS)
  // Checkpoint cadence for the periodic (non-mutation-triggered) persistCurrentState() calls.
  const PERSIST_EVERY_N_STEPS = 5
  let stepCount = 0
  // Bundled (rather than loose `let`s) because agentOrchestratorToolResultProcessor.ts
  // mutates these in place across steps -- see runToolResultProcessing below.
  const mutableFlags: { hasFileMutations: boolean; hasVerifiedBuild: boolean; currentOverriddenModel: string | null } = {
    hasFileMutations: false,
    hasVerifiedBuild: false,
    currentOverriddenModel: null,
  }
  // Same pattern, for the counters agentOrchestratorResponseInterpreter.ts advances.
  const responseInterpreterState: ResponseInterpreterState = {
    noToolStreak: 0,
    stagnationStreak: 0,
    consecutiveAskAttempts: 0,
  }
  /** DoD violation reasons already surfaced to the model — each intercepts `finish` at most once. */
  const surfacedDodReasons = new Set<string>()
  const loopDetector = new AgentActionLoopDetector(2)
  const circuitBreaker = new StagnationCircuitBreaker(10, 5)
  const executionGuard = new TransactionalExecutionGuard(workspacePath || process.cwd())

  // Restore session state if resuming an existing session
  const savedState = await agentSessionStateRepository.loadSessionState(sessionId, workspacePath)
  const initialUserTask = savedState?.initialUserTask || payload.initialUserTask || userTask

  if (savedState) {
    stepCount = savedState.stepCount || 0
    if (savedState.episodes && savedState.episodes.length > 0) {
      episodicCompactor.fromState(savedState.episodes, savedState.recentFullLogs)
    }
    if (savedState.planMilestones && savedState.planMilestones.length > 0) {
      goalPlanner.loadMilestones(savedState.planMilestones)
    }
    emitLog('info', `🔄 Restored Session State [${sessionId}]: Continuing from Step ${stepCount} with ${episodicCompactor.episodeCount} prior steps in memory.`)
  }

  const emitStepUpdate = (statusText?: string) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:step-update', {
        step: stepCount,
        maxSteps: MAX_STEPS === Infinity ? 999 : MAX_STEPS,
        maxStepsLabel,
        statusText,
      })
    }
    if (settings.enableCodingAgentDebugLog && goalPlanner.hasPlan()) {
      codingAgentLogger.logPlanMilestoneUpdate(
        sessionId,
        stepCount,
        [...goalPlanner.getMilestones()],
        statusText
      )
    }
  }

  const persistCurrentState = async () => {
    // Only the plan's completion flag is persisted: every other field of the compact
    // state is a projection of planMilestones, which is already stored below.
    const isPlanCompleted = goalPlanner.hasPlan()
      ? PlanManager.getCompactStateFromMilestones(goalPlanner.getMilestones(), userTask).isCompleted
      : false

    await agentSessionStateRepository.saveSessionState({
      sessionId,
      workspacePath,
      agentMode,
      stepCount,
      maxSteps: MAX_STEPS === Infinity ? 999 : MAX_STEPS,
      episodes: episodicCompactor.getEpisodes(),
      recentFullLogs: episodicCompactor.getRecentFullLogs(),
      planMilestones: [...goalPlanner.getMilestones()],
      userTask,
      initialUserTask,
      updatedAt: new Date().toISOString(),
      status: isPlanCompleted ? 'COMPLETED' : 'IN_PROGRESS',
    })

    if (workspacePath) {
      await agentSessionStateRepository.saveSessionTrackerMarkdown(workspacePath, buildSessionTracker())
    }
  }

  /**
   * Builds the single SESSION_TRACKER.md payload from live session state: verified milestones
   * as completed work, failed ones as debt, pending ones as next steps, plus every file this
   * session actually touched. One format, produced here and parsed back by SessionDebtTracker.
   */
  const buildSessionTracker = (summaryText?: string): SessionDebtTracker => {
    const milestones = goalPlanner.getMilestones()
    return new SessionDebtTracker({
      sessionId,
      completedTasks: milestones.filter((m) => m.status === 'verified').map((m) => `${m.id}: ${m.title}`),
      unresolvedIssues: milestones
        .filter((m) => m.status === 'failed')
        .map((m) => `${m.id}: ${m.title}${m.notes ? ` (${m.notes})` : ''}`),
      nextSteps: milestones
        .filter((m) => m.status === 'pending' || m.status === 'in_progress')
        .map((m) => `${m.id}: ${m.title}`),
      modifiedFiles: Array.from(sessionChangedFiles.keys()),
      summaryText,
    })
  }

  /** Frozen per-session Ollama context window — see the num_ctx block inside the loop. */
  let sessionNumCtx: number | null = null
  /** Per-file line deltas applied during this session, for the UI's change metrics. */
  const sessionChangedFiles = new Map<string, { additions: number; deletions: number }>()

  // Global session timeout: guarantees SESSION END is always written to the audit log.
  // Default: 45 minutes. Configurable via settings.agentSessionTimeoutMinutes (if added).
  const SESSION_TIMEOUT_MS = Math.max(5, (settings as any).agentSessionTimeoutMinutes || 45) * 60 * 1000
  session.timeoutHandle = setTimeout(async () => {
    // Identity guard: sessionIds are reused across consecutive runs of the same UI session
    // (useCodingAgent.ts passes a stable activeSessionId), so a timer left over from an
    // earlier run must never act on the run currently registered under that id.
    if (activeAgentSessions.get(sessionId) !== session) return
    if (isSessionActive()) {
      const timeoutSummary = `Sessione terminata automaticamente: superato il limite di ${Math.round(SESSION_TIMEOUT_MS / 60000)} minuti.`
      logger.log('WARN', 'AgentOrchestratorApp', `[SESSION TIMEOUT] ${timeoutSummary} SessionId: ${sessionId}`)
      emitLog('info', `⏱️ Session Timeout: ${timeoutSummary}`)
      session.isCancelled = true
      if (session.pendingApprovalResolve) {
        session.pendingApprovalResolve({ approved: false })
        session.pendingApprovalResolve = undefined
      }
      codingAgentLogger.logSessionEnd(sessionId, stepCount, false, timeoutSummary)
      emitDone(false, timeoutSummary)
      agentToolExecutorService.rollbackJournal()
      await persistCurrentState()
      finalizeSession()
    }
  }, SESSION_TIMEOUT_MS)

  const clearSessionTimeout = () => {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle)
      session.timeoutHandle = null
    }
  }

  /**
   * Single exit point for the loop: clears the session timeout and deregisters the session.
   * Every early return path must go through this — a timer left armed on an abandoned session
   * would later fire against whatever run holds the same sessionId.
   */
  const finalizeSession = () => {
    clearSessionTimeout()
    activeAgentSessions.delete(sessionId)
  }

  /**
   * Sends `agent:approval-request` and pauses the calling step in place until the renderer
   * answers via the `agent:approval-response` IPC channel (see `respondToApproval` below),
   * or until cancellation/timeout resolves it to `false` (see cleanupSession / the session
   * timeout handler above). The session stays registered in `activeAgentSessions` the whole
   * time, so this is a real pause of the same loop iteration -- not the "end the task, then
   * have the renderer re-execute the action on its own" round trip this replaces.
   */
  const requestApproval = (payload: Record<string, unknown>): Promise<ApprovalResponse> => {
    return new Promise<ApprovalResponse>((resolve) => {
      if (!session.targetWindow || session.targetWindow.isDestroyed()) {
        resolve({ approved: false })
        return
      }
      session.pendingApprovalResolve = resolve
      session.targetWindow.webContents.send('agent:approval-request', { sessionId: session.id, ...payload })
    })
  }

  while (stepCount < MAX_STEPS && isSessionActive()) {
    stepCount++
    emitStepUpdate(`Step ${stepCount}/${maxStepsLabel}`)
    // Periodic checkpoint: persisting on every single step is unnecessary I/O churn.
    // The first step and every Nth step get a checkpoint; mutating tool calls also
    // trigger an immediate persist (see hasFileMutations below). All session-ending
    // exit paths (finish/cancel/error/timeout/circuit-breaker) persist unconditionally.
    if (stepCount === 1 || stepCount % PERSIST_EVERY_N_STEPS === 0) {
      await persistCurrentState()
    }

    const hasRecentToolFailure = episodicCompactor.failureCount > 0
    const errorCountInHistory = episodicCompactor.failureCount

    const routedComplexity = evaluateTaskComplexity(userTask, {
      attachedFilesCount: payload.pinnedFiles?.length || 0,
      contextSizeChars: payload.activeFile?.content?.length || 0,
      settings,
      availableModels,
      hasRecentToolFailure,
      errorCountInHistory,
    })

    if (routedComplexity.isEscalated && stepCount > 1) {
      emitLog('info', `⚡ Complexity Escalated: ${routedComplexity.modelName}`, routedComplexity.reasoning)
    }

    let targetModel: string = mutableFlags.currentOverriddenModel
      ? mutableFlags.currentOverriddenModel
      : settings.useComplexityRouting
      ? routedComplexity.modelName
      : (settings.codingModel || settings.defaultModel || 'llama3.2')

    // Native tool-calling routing: when the primary model is detected as tool-calling
    // capable (see ollamaToolCallingCapability.ts), route via POST /api/chat with the
    // structured tool catalog instead of relying solely on the prompt-engineered JSON
    // convention. toolParser.ts still parses the result either way (see
    // agentStreamTransport.ts's serializeNativeToolCall), so downstream tool execution
    // is unaffected by which path produced the output. Computed here (before prompt
    // assembly) so AgentPromptAssembler can omit the redundant prose tool block (AGT2).
    const targetModelToolCallingCapable = supportsNativeToolCalling(targetModel, modelCapabilities)
    if (targetModelToolCallingCapable) {
      // The native tool-calling /api/chat path doesn't populate `context` (see
      // agentStreamTransport.ts), so any cached baseline from an earlier
      // /api/generate turn would be stale. Clear it so a later turn that
      // returns to the /api/generate path always starts from a full resend.
      session.ollamaContextModel = undefined
    }

    const intermediateModel = settings.complexityStandardModel || settings.codingModel || settings.defaultModel || 'llama3.2'
    const fallbackModel = settings.complexityFastModel || settings.defaultModel || 'llama3.2'
    const heavyEscalationModel = settings.complexityHeavyModel || undefined

    const cachedGpu = getCachedGpuInfo()
    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(
      settings.hardwareProfile,
      {
        hasGpu: cachedGpu?.hasNvidiaGpu,
        vramTotalMB: cachedGpu?.vramTotalMB,
        systemRamGB: getMemoryInfo().totalRAMGB,
        cpuCount: os.cpus()?.length,
      },
      routedComplexity.tier
    )
    const skillsBlock = await skillAppService.getContextSkillsBlock(skillMatchContext, workspacePath, 3, skillMatchingOptions)

    const compiledHistoryBlock = episodicCompactor.compilePromptHistoryBlock(10000)
    const planBlock = goalPlanner.compileProgressPrompt()

    let debtTrackerBlock = ''
    if (workspacePath) {
      try {
        const trackerContent = agentSessionStateRepository.loadSessionTrackerMarkdown(workspacePath)
        if (trackerContent) {
          const tracker = SessionDebtTracker.parseTrackerMarkdown(trackerContent)
          debtTrackerBlock = tracker.compilePromptBlock()
        }
      } catch (err: any) {
        logger.log('WARN', 'AgentOrchestratorAppService', `Failed reading SESSION_TRACKER.md: ${err.message}`)
      }
    }

    const effectiveAttachedContext = [debtTrackerBlock, attachedContext].filter(Boolean).join('\n\n')

    // Assemble base prompt segments, then apply heuristic compaction at 75% watermark
    const assembled = AgentPromptAssembler.assembleTurnPrompt({
      userTask,
      initialUserTask,
      agentMode,
      stepCount,
      maxSteps: MAX_STEPS,
      complexityTier: routedComplexity.tier,
      workspacePath,
      isStandaloneMode,
      activeFile: payload.activeFile,
      pinnedFilesContextStr,
      skillsBlock,
      planBlock,
      toolOutputHistory: compiledHistoryBlock,
      attachedContext: effectiveAttachedContext,
      projectContextMapStr,
      settings,
      runtimeOpts,
      toolCallingCapable: targetModelToolCallingCapable,
    })
    const basePrompt = assembled.prompt

    const compactionResult = HeuristicContextCompactor.compile(
      {
        systemPrompt: basePrompt.split('\n\n')[0] || basePrompt,
        activePlanBlock: planBlock,
        pinnedFilesBlock: pinnedFilesContextStr,
        activeFileBlock: payload.activeFile ? `Active File: ${payload.activeFile.name}\n${(payload.activeFile.content || '').slice(0, 8000)}` : '',
        skillsBlock,
        historyBlock: compiledHistoryBlock,
        attachedContext,
        projectMapBlock: projectContextMapStr,
      },
      runtimeOpts.maxContextChars
    )
    const turnPrompt = compactionResult.wasCompacted ? compactionResult.prompt : basePrompt
    if (compactionResult.wasCompacted) {
      emitLog('info', `🗜️ Context Compacted: ${compactionResult.originalChars} → ${compactionResult.finalChars} chars (heuristic, zero-cost)`)
    }

    // num_ctx is frozen for the lifetime of the session and only ever allowed to GROW.
    // Ollama reallocates its KV cache whenever num_ctx changes, which evicts the prompt
    // cache — recomputing it per step (as this did) silently defeated the `context`
    // continuation reuse implemented above (AGT1), and on CPU-only machines cost a model
    // reload almost every turn. Growth is still permitted so a prompt that outgrows the
    // frozen window is never silently truncated; the cached baseline is dropped in that
    // case because the tokens it holds no longer correspond to the new window.
    const requiredNumCtx = calculateDynamicContextWindow(turnPrompt.length, runtimeOpts.num_ctx)
    if (sessionNumCtx === null) {
      sessionNumCtx = requiredNumCtx
    } else if (requiredNumCtx > sessionNumCtx) {
      emitLog('info', `📐 Context window grown: ${sessionNumCtx} → ${requiredNumCtx} tokens (prompt outgrew the frozen window).`)
      sessionNumCtx = requiredNumCtx
      session.ollamaContextModel = undefined
      session.ollamaContextTokens = undefined
      session.ollamaContextStableSection = undefined
      session.ollamaContextHistoryBlock = undefined
    }
    runtimeOpts.num_ctx = sessionNumCtx

    emitLog('tool_call', `[Step ${stepCount}/${maxStepsLabel}] Consulting LLM (${targetModel}) [ctx:${runtimeOpts.num_ctx}${fsmMode.getMode() !== 'AGENT' ? ` | Mode:${fsmMode.getMode()}` : ''}]...`)
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logTurnPrompt(sessionId, stepCount, targetModel, runtimeOpts.num_ctx, turnPrompt)
    }

    // AGT1: reuse Ollama's `context` continuation instead of resending the full
    // prompt whenever this turn's stable section + history are a byte-exact
    // continuation of the prior turn's on the SAME model (see
    // ollamaContextCacheManager.ts). Native tool-calling turns never qualify
    // (the /api/chat path doesn't populate `context`).
    const contextReuseDecision = targetModelToolCallingCapable
      ? { reusedContext: false as const, promptToSend: turnPrompt }
      : resolveOllamaContextReuse({
          targetModel,
          stableSection: assembled.stableSection,
          historyBlock: assembled.historyBlock,
          turnSuffix: assembled.turnSuffix,
          fullPrompt: turnPrompt,
          wasCompacted: compactionResult.wasCompacted,
          baseline:
            session.ollamaContextModel === targetModel && session.ollamaContextStableSection !== undefined
              ? {
                  model: session.ollamaContextModel,
                  stableSection: session.ollamaContextStableSection,
                  historyBlock: session.ollamaContextHistoryBlock || '',
                  contextTokens: session.ollamaContextTokens || [],
                }
              : null,
        })

    if (contextReuseDecision.reusedContext) {
      emitLog(
        'info',
        `⚡ Ollama Context Reuse: sending ${contextReuseDecision.promptToSend.length} chars instead of the full ${turnPrompt.length}-char prompt (KV-cache continuation).`
      )
    }

    let streamedOutput = ''
    let lastDispatchEscalated = false
    try {
      const dispatchRes = await ResilientModelDispatcher.executeWithFallback(
        {
          primaryModel: targetModel,
          intermediateModel,
          fallbackModel,
          heavyEscalationModel,
          runtimeOpts,
        },
        {
          prompt: turnPrompt,
          keepAlive: '30m',
          ollamaEndpoint: settings.ollamaHost,
          toolCallingCapable: targetModelToolCallingCapable,
          toolCatalog: targetModelToolCallingCapable ? OLLAMA_TOOL_SCHEMA_CATALOG : undefined,
          onTokenChunk: (chunk) => {
            if (session.targetWindow && !session.targetWindow.isDestroyed()) {
              session.targetWindow.webContents.send('agent:stream-token', { step: stepCount, chunk })
            }
          },
          isCancelled: () => !isSessionActive(),
          onHttpRequestCreated: (req) => {
            session.activeHttpRequest = req
          },
          onContextReceived: (contextTokens, respondingModel) => {
            // Only cache when this turn's prompt matched assembled.stableSection/historyBlock
            // exactly — HeuristicContextCompactor rewrites that structure on compaction, so
            // the returned tokens wouldn't correspond to the cached baseline shape (AGT1).
            if (compactionResult.wasCompacted) return
            session.ollamaContextTokens = contextTokens
            session.ollamaContextModel = respondingModel
            session.ollamaContextStableSection = assembled.stableSection
            session.ollamaContextHistoryBlock = assembled.historyBlock
          },
        },
        (fromModel, toModel, reason) => {
          const isHeavy = toModel === heavyEscalationModel
          lastDispatchEscalated = isHeavy
          const label = isHeavy ? '🔺 Heavy Tier Escalation' : '⚡ Resilient Fallback'
          emitLog('info', `${label}: ${fromModel} → ${toModel}`, `Triggered: ${reason}`)
        },
        contextReuseDecision.reusedContext
          ? { prompt: contextReuseDecision.promptToSend, previousContext: contextReuseDecision.contextTokens! }
          : undefined
      )
      streamedOutput = dispatchRes.output
      if (dispatchRes.isEscalated || lastDispatchEscalated) {
        emitLog('info', `🔺 Heavy Tier active (${dispatchRes.usedModel}): VRAM eviction applied before escalation.`)
      }
      session.activeHttpRequest = null
    } catch (err: any) {
      emitLog('info', `LLM Stream error on step ${stepCount}: ${err.message}`)
      emitDone(false, `LLM Stream Error: ${err.message}`)
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logSessionEnd(sessionId, stepCount, false, `LLM Error: ${err.message}`)
      }
      agentToolExecutorService.rollbackJournal()
      await persistCurrentState()
      finalizeSession()
      return { success: false, summary: `LLM Error: ${err.message}` }
    }

    if (!isSessionActive()) {
      emitLog('info', 'Agent execution cancelled by user.')
      emitDone(false, 'Task cancelled by user.')
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logSessionEnd(sessionId, stepCount, false, 'Task cancelled by user.')
      }
      agentToolExecutorService.rollbackJournal()
      await persistCurrentState()
      finalizeSession()
      return { success: false, summary: 'Task cancelled' }
    }

    emitLog('info', `AI Agent (${agentMode.toUpperCase()} Step ${stepCount}):`, streamedOutput)
    if (settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logLlmResponse(sessionId, stepCount, streamedOutput)
    }

    // Interprets the raw LLM output for this turn: plan extraction, tool-call parsing (with
    // no-tool-call / malformed-call recovery), and the finish/loop-detection/ask special
    // cases. See agentOrchestratorResponseInterpreter.ts for the exact step order rationale.
    const interpretation = await interpretTurnResponse({
      streamedOutput,
      agentMode,
      stepCount,
      maxSteps: MAX_STEPS,
      isUnlimitedSteps,
      workspacePath,
      settings,
      sessionId,
      hasRecentToolFailure,
      errorCountInHistory,
      compiledHistoryBlock,
      flags: mutableFlags,
      surfacedDodReasons,
      state: responseInterpreterState,
      episodicCompactor,
      goalPlanner,
      executionGuard,
      loopDetector,
      emitLog,
      emitDone,
      persistCurrentState,
      finalizeSession,
      buildSessionTracker,
    })
    if (interpretation.outcome === 'continue') continue
    if (interpretation.outcome === 'return') return interpretation.result
    const parsedTool = interpretation.parsedTool

    if (fsmMode.getMode() === 'PLAN') {
      emitLog('info', `[PLAN Mode] Proposed Tool (${parsedTool.tool}):`, JSON.stringify(parsedTool.parameters, null, 2))
      emitDone(true, `Plan Mode completed step proposal for ${parsedTool.tool}`)
      if (settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logSessionEnd(sessionId, stepCount, true, `Proposed tool call: ${parsedTool.tool}`)
      }
      await persistCurrentState()
      finalizeSession()
      return { success: true, summary: `Proposed tool call: ${parsedTool.tool}` }
    }

    // Approval + FSM permission gates (git_commit always-confirm, ASK-mode mutating-tool
    // approval, FSM tool-permission check) — see agentOrchestratorToolGates.ts for the
    // exact gate ordering rationale.
    const gateResult = await runToolGates({
      parsedTool,
      agentMode,
      fsmMode,
      workspacePath,
      stepCount,
      episodicCompactor,
      emitLog,
      requestApproval,
    })
    if (gateResult.outcome === 'denied') continue
    const toolCallForExecution = gateResult.toolCallForExecution

    // Orchestrator-level pseudo-tool: the model's explicit handle on plan progression.
    // Handled here rather than in agentToolExecutorService because the plan lives in this
    // loop's GoalDecompositionPlanner, not on disk. Before this tool existed, milestone
    // status could only ever be inferred heuristically from tool side effects.
    if ((parsedTool.tool as string) === 'update_plan') {
      await handleUpdatePlanTool({
        parsedTool,
        goalPlanner,
        workspacePath,
        emitLog,
        emitStepUpdate,
        episodicCompactor,
        persistCurrentState,
        settings,
        sessionId,
        stepCount,
        maxStepsLabel,
      })
      continue
    }

    // Execute tool through tool executor service
    const toolRes = await agentToolExecutorService.executeTool(
      toolCallForExecution,
      workspacePath,
      settings,
      (terminalChunk) => emitLog('terminal', terminalChunk),
      (childProc) => {
        session.activeChildProcess = childProc
      }
    )
    agentToolExecutorService.endJournalStep()

    const processingOutcome = await runToolResultProcessing({
      toolRes,
      parsedTool,
      stepCount,
      sessionId,
      settings,
      workspacePath,
      targetModel,
      intermediateModel,
      fallbackModel,
      heavyEscalationModel,
      isUnlimitedSteps,
      flags: mutableFlags,
      sessionChangedFiles,
      episodicCompactor,
      goalPlanner,
      executionGuard,
      circuitBreaker,
      isSessionActive,
      targetWindow: session.targetWindow,
      emitLog,
      emitDone,
      persistCurrentState,
      finalizeSession,
    })
    if (processingOutcome.outcome === 'return') return processingOutcome.result
  }

  const endSummary = stepCount >= MAX_STEPS && MAX_STEPS !== Infinity
    ? `Raggiunto il limite massimo di passaggi configurato (${MAX_STEPS} step).`
    : `Completed ${stepCount} agent steps.`
  clearSessionTimeout()
  emitDone(true, endSummary)
  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionEnd(sessionId, stepCount, true, endSummary)
  }
  await persistCurrentState()
  finalizeSession()
  return { success: true, summary: endSummary }
}
