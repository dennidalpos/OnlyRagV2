import { BrowserWindow } from 'electron'
import { logger } from '../../diagnostics'
import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import { handleUpdatePlanTool } from './agentOrchestratorPlanTool'
import { runToolGates } from './agentOrchestratorToolGates'
import { runToolResultProcessing } from './agentOrchestratorToolResultProcessor'
import { interpretTurnResponse } from './agentOrchestratorResponseInterpreter'
import { runTurnDispatch } from './agentOrchestratorTurnDispatch'
import { bootstrapAgentSession } from './agentOrchestratorBootstrap'
import { runProjectVerification } from './agentOrchestratorVerificationRunner'
import {
  promoteMilestonesProvenBy,
  selectMilestonesAwaitingVerification,
} from './agentOrchestratorCircuitBreakerAndVerification'
import {
  budgetExhaustionSummary,
  shouldVerifyOnBudgetExhaustion,
} from '../domain/agent/budgetExhaustionVerification'
import type { BudgetExhaustionOutcome } from '../domain/agent/budgetExhaustionVerification'
import { agentToolExecutorService } from './agentToolExecutorService'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AgentSession } from './agentOrchestratorTypes'

export type { AgentSession }

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
  if (session.activeCancelHandle) {
    try {
      session.activeCancelHandle()
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestrator', `Failed cancelling active stream during cleanup: ${err?.message}`)
    }
    session.activeCancelHandle = null
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
    activeCancelHandle: null,
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
    modelMetrics,
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
      modelMetrics,
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
      hasVerifiedBuild: mutableFlags.hasVerifiedBuild,
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
      },
      skillsBlock
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

  // The step budget was the one session exit that verified nothing. `finish` runs the
  // project's own check and promotes whatever it proves; falling out of the loop went straight
  // to emitDone, so a run that delivered every file its plan named and never spent a step on
  // `finish` closed with 0/14 verified and no check ever attempted. See
  // domain/agent/budgetExhaustionVerification.ts for the measurement (live-full-task,
  // 2026-08-25T12:11). The promotion criterion is untouched: only a real passing command over
  // deliverables really on disk promotes anything.
  const budgetExhausted = stepCountBox.value >= MAX_STEPS && MAX_STEPS !== Infinity
  let exhaustionOutcome: BudgetExhaustionOutcome = { kind: 'not_attempted' }

  if (
    shouldVerifyOnBudgetExhaustion({
      budgetExhausted,
      sessionActive: isSessionActive(),
      hasWorkspace: Boolean(workspacePath),
      verifyBeforeFinish: (settings as any).verifyBeforeFinish !== false,
      hasFileMutations: mutableFlags.hasFileMutations,
      hasVerifiedBuild: mutableFlags.hasVerifiedBuild,
      promotableMilestoneCount: selectMilestonesAwaitingVerification({ workspacePath, goalPlanner }).length,
    })
  ) {
    emitLog('info', '🔎 Budget di step esaurito: verifica finale del progetto...')
    const run = await runProjectVerification(workspacePath, (chunk) => emitLog('terminal', chunk))
    if (!run.hasVerificationCommand) {
      exhaustionOutcome = { kind: 'no_command' }
    } else if (run.passed) {
      mutableFlags.hasVerifiedBuild = true
      const command = run.command || 'verification command'
      const promoted = promoteMilestonesProvenBy({ workspacePath, goalPlanner, emitLog }, command)
      exhaustionOutcome = { kind: 'passed', command, promoted }
    } else {
      exhaustionOutcome = { kind: 'failed', command: run.command || 'verification command' }
      // Printed, not swallowed: the failure is the reason the plan stays unverified, and it is
      // the only place a user reading the transcript can find out why.
      emitLog('info', '⛔ Verifica finale fallita: nessuna milestone promossa.', run.failureDetail, {
        category: 'system_alert',
      })
    }
  }

  const endSummary = budgetExhausted
    ? budgetExhaustionSummary(MAX_STEPS, exhaustionOutcome)
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
