import { BrowserWindow } from 'electron'
import http from 'node:http'
import { logger } from '../../diagnostics'
import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import { handleUpdatePlanTool } from './agentOrchestratorPlanTool'
import { runToolGates } from './agentOrchestratorToolGates'
import { runToolResultProcessing } from './agentOrchestratorToolResultProcessor'
import { interpretTurnResponse } from './agentOrchestratorResponseInterpreter'
import { runTurnDispatch } from './agentOrchestratorTurnDispatch'
import { bootstrapAgentSession } from './agentOrchestratorBootstrap'
import { agentToolExecutorService } from './agentToolExecutorService'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'

export interface ApprovalResponse {
  approved: boolean
  /** Indices (into groupDiffIntoHunks' result) of the hunks the user approved, for a partial (not all-or-nothing) file-mutation approval. */
  approvedHunkIndices?: number[]
}

export interface AgentSession {
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

  // One-shot session setup: task/workspace/settings resolution, model warm-up, skill
  // matching, state restore, and the persist/watchdog closures the turn loop shares below.
  // See agentOrchestratorBootstrap.ts for the exact composition.
  const boot = await bootstrapAgentSession({
    payload,
    session,
    sessionId,
    isSessionActive,
    deregisterSession: () => activeAgentSessions.delete(sessionId),
  })
  const {
    userTask,
    initialUserTask,
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
    episodicCompactor,
    goalPlanner,
    fsmMode,
    executionGuard,
    circuitBreaker,
    loopDetector,
    surfacedDodReasons,
    mutableFlags,
    responseInterpreterState,
    sessionNumCtxBox,
    sessionChangedFiles,
    stepCountBox,
    MAX_STEPS,
    maxStepsLabel,
    isUnlimitedSteps,
    emitLog,
    emitDone,
    emitStepUpdate,
    persistCurrentState,
    buildSessionTracker,
    requestApproval,
    finalizeSession,
    clearSessionTimeout,
  } = boot

  if (!workspacePath && !isStandaloneMode) {
    const errorMsg = 'Nessuna cartella di progetto / workspace specificata. Per creare o scrivere file di progetto, seleziona o apri prima una directory di lavoro in OnlyRag.'
    emitLog('info', `❌ Errore Workspace: ${errorMsg}`)
    emitDone(false, errorMsg)
    clearSessionTimeout()
    finalizeSession()
    return { success: false, summary: errorMsg }
  }

  // Checkpoint cadence for the periodic (non-mutation-triggered) persistCurrentState() calls.
  const PERSIST_EVERY_N_STEPS = 5

  while (stepCountBox.value < MAX_STEPS && isSessionActive()) {
    stepCountBox.value++
    emitStepUpdate(`Step ${stepCountBox.value}/${maxStepsLabel}`)
    // Periodic checkpoint: persisting on every single step is unnecessary I/O churn.
    // The first step and every Nth step get a checkpoint; mutating tool calls also
    // trigger an immediate persist (see hasFileMutations below). All session-ending
    // exit paths (finish/cancel/error/timeout/circuit-breaker) persist unconditionally.
    if (stepCountBox.value === 1 || stepCountBox.value % PERSIST_EVERY_N_STEPS === 0) {
      await persistCurrentState()
    }

    // Routes the turn to a model, assembles/compacts the prompt, freezes/grows num_ctx,
    // decides Ollama context-cache reuse, and dispatches to the LLM with resilient fallback.
    // See agentOrchestratorTurnDispatch.ts for the exact step order rationale.
    const dispatchOutcome = await runTurnDispatch({
      userTask,
      initialUserTask,
      agentMode,
      stepCount: stepCountBox.value,
      maxStepsLabel,
      maxSteps: MAX_STEPS,
      workspacePath,
      isStandaloneMode,
      settings,
      sessionId,
      payload,
      availableModels,
      modelCapabilities,
      attachedContext,
      pinnedFilesContextStr,
      projectContextMapStr,
      skillMatchContext,
      skillMatchingOptions,
      skillsBlock,
      episodicCompactor,
      goalPlanner,
      fsmMode,
      currentOverriddenModel: mutableFlags.currentOverriddenModel,
      session,
      sessionNumCtxBox,
      isSessionActive,
      emitLog,
      emitDone,
      persistCurrentState,
      finalizeSession,
    })
    if (dispatchOutcome.outcome === 'return') return dispatchOutcome.result
    const {
      streamedOutput,
      hasRecentToolFailure,
      errorCountInHistory,
      compiledHistoryBlock,
      targetModel,
      fallbackModel,
    } = dispatchOutcome.data

    // Interprets the raw LLM output for this turn: plan extraction, tool-call parsing (with
    // no-tool-call / malformed-call recovery), and the finish/loop-detection/ask special
    // cases. See agentOrchestratorResponseInterpreter.ts for the exact step order rationale.
    const interpretation = await interpretTurnResponse({
      streamedOutput,
      agentMode,
      stepCount: stepCountBox.value,
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
        codingAgentLogger.logSessionEnd(sessionId, stepCountBox.value, true, `Proposed tool call: ${parsedTool.tool}`)
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
      stepCount: stepCountBox.value,
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
        stepCount: stepCountBox.value,
        maxStepsLabel,
      })
      continue
    }

    // Execute tool through tool executor service
    const toolStartedAtMs = Date.now()
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
      toolStartedAtMs,
      stepCount: stepCountBox.value,
      sessionId,
      settings,
      workspacePath,
      targetModel,
      fallbackModel,
      isUnlimitedSteps,
      flags: mutableFlags,
      sessionChangedFiles,
      episodicCompactor,
      goalPlanner,
      executionGuard,
      circuitBreaker,
      loopDetector,
      isSessionActive,
      targetWindow: session.targetWindow,
      emitLog,
      emitDone,
      persistCurrentState,
      finalizeSession,
    })
    if (processingOutcome.outcome === 'return') return processingOutcome.result
  }

  const endSummary = stepCountBox.value >= MAX_STEPS && MAX_STEPS !== Infinity
    ? `Raggiunto il limite massimo di passaggi configurato (${MAX_STEPS} step).`
    : `Completed ${stepCountBox.value} agent steps.`
  clearSessionTimeout()
  emitDone(true, endSummary)
  if (settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionEnd(sessionId, stepCountBox.value, true, endSummary)
  }
  await persistCurrentState()
  finalizeSession()
  return { success: true, summary: endSummary }
}
