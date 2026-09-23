import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import { logger } from '../infrastructure/logging/logger'
import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import { handleUpdatePlanTool } from './agentOrchestratorPlanTool'
import { runToolGates } from './agentOrchestratorToolGates'
import { applyVersionedReadEvidence, runToolResultProcessing } from './agentOrchestratorToolResultProcessor'
import { interpretTurnResponse } from './agentOrchestratorResponseInterpreter'
import { collectTurnContext, requestTurnProposal } from './agentOrchestratorTurnDispatch'
import { bootstrapAgentSession } from './agentOrchestratorBootstrap'
import { closeAgentRunFromEvidence } from './agentOrchestratorApplicationClosure'
import { agentToolExecutorService } from './agentToolExecutorService'
import { taskRunner } from '../infrastructure/process/taskRunner'
import type { AgentSession } from './agentOrchestratorTypes'
import { createAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'
import { matchesAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'
import type { AgentRunIdentity } from '../../../shared/types'
import type { DisposableAgentWorkspace } from '../infrastructure/filesystem/disposableAgentWorkspace'
import { evaluateAgentCodingPreflight } from './agentCodingPreflight'
import { workspaceAppService } from './workspaceAppService'
import { ollamaAppService } from './ollamaAppService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'

export type { AgentSession }

const activeAgentSessions = new Map<string, AgentSession>()

function cleanupSession(session: AgentSession) {
  session.isCancelled = true
  session.abortController?.abort()
  session.completionStatus = 'cancelled'
  session.terminalSummary = "Task interrotto dall'utente."
  void session.persistCancellation?.()
  // A step paused inside requestApproval() must not block forever just because the task was cancelled instead of answered: resolving false lets the awaited Promise settle, the paused `while` loop observe isCancelled on its next check, and exit cleanly.
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
  let rollbackRestoredFiles = 0
  const rollbackErrors: string[] = []
  try {
    const rollback = agentToolExecutorService.rollbackJournal()
    rollbackRestoredFiles = rollback.restoredCount
    rollbackErrors.push(...rollback.errors)
  } catch (err: any) {
    rollbackErrors.push(err?.message || String(err))
    logger.log('WARN', 'AgentOrchestrator', `Failed rolling back journal during cleanup: ${err?.message}`)
  }
  try {
    session.workspaceTransaction?.dispose()
  } catch (err: any) {
    logger.log('WARN', 'AgentOrchestrator', `Failed discarding isolated workspace during cleanup: ${err?.message}`)
  }
  if (session.rendererEvents?.isAvailable()) {
    const nonRollbackEffects = [...(session.nonRollbackEffects || []), ...rollbackErrors.map((error) => `rollback_workspace: ${error}`)]
    session.rendererEvents.send('agent:log', {
      ...session.identity,
      id: `${Date.now()}-cancelled`,
      timestamp: new Date().toISOString(),
      type: 'info',
      message: "Task interrotto dall'utente.",
    })
    session.rendererEvents.send('agent:done', {
      ...session.identity,
      success: false,
      summary: "Task interrotto dall'utente.",
      completionStatus: 'cancelled',
      evidence: {
        changedFiles: session.changedFiles || [],
        verification: session.lastVerification,
        cancellationStatus: nonRollbackEffects.length > 0 ? 'residual_effects' : 'rolled_back',
        rollbackRestoredFiles,
        nonRollbackEffects,
      },
    })
  }
}

export function cancelActiveAgentTask(targetRunId?: string) {
  if (targetRunId) {
    const session = activeAgentSessions.get(targetRunId)
    if (session) {
      cleanupSession(session)
      activeAgentSessions.delete(targetRunId)
      logger.log('INFO', 'AgentOrchestratorApp', `Agent run ${targetRunId} cancelled by user.`)
    }
  } else {
    for (const [id, session] of activeAgentSessions.entries()) {
      cleanupSession(session)
      activeAgentSessions.delete(id)
    }
    logger.log('INFO', 'AgentOrchestratorApp', `All active agent sessions cancelled by user.`)
  }
}

/** Applies manual prompt compaction to the next turn without altering Renderer audit logs. */
export function requestActiveAgentContextCompaction(target: AgentRunIdentity | string): boolean {
  const runId = typeof target === 'string' ? target : target.runId
  const session = activeAgentSessions.get(runId)
  if (!session || (typeof target !== 'string' && !matchesAgentRunIdentity(session.identity, target))) return false
  session.forceContextCompaction = true
  session.ollamaContextTokens = undefined
  session.ollamaContextModel = undefined
  session.ollamaContextStableSection = undefined
  session.ollamaContextHistoryBlock = undefined
  return true
}

/** Answers a step paused inside requestApproval(). */
export function respondToApproval(target: AgentRunIdentity | string, approved: boolean, approvedHunkIndices?: number[]): boolean {
  const targetRunId = typeof target === 'string' ? target : target.runId
  const session = activeAgentSessions.get(targetRunId)
  if (typeof target !== 'string' && session && !matchesAgentRunIdentity(session.identity, target)) return false
  if (!session || !session.pendingApprovalResolve) return false
  const resolve = session.pendingApprovalResolve
  session.pendingApprovalResolve = undefined
  resolve({ approved, approvedHunkIndices })
  return true
}

export async function runAgentOrchestratorLoop(
  payload: AgentTaskPayload,
  rendererEvents: RendererEventSink | null,
  customSessionId?: string,
  workspaceTransaction?: DisposableAgentWorkspace,
): Promise<AgentTaskResult> {
  if (!payload.userTask || !payload.userTask.trim()) {
    return { success: false, summary: 'Task prompt empty', error: 'Task prompt is required', completionStatus: 'blocked' }
  }

  const conversationId =
    payload.identity?.conversationId || payload.sessionId || customSessionId || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  const identity = createAgentRunIdentity({
    ...payload.identity,
    runId: payload.identity?.runId || customSessionId || conversationId,
    conversationId,
    workspacePath: payload.workspacePath,
  })
  const sessionId = identity.conversationId
  const runId = identity.runId
  const session: AgentSession = {
    id: runId,
    identity,
    isCancelled: false,
    abortController: new AbortController(),
    rendererEvents,
    activeCancelHandle: null,
    activeChildProcess: null,
    workspaceTransaction,
    forceContextCompaction: Boolean(payload.forceContextCompaction),
  }
  activeAgentSessions.set(runId, session)

  // Compares by identity, not just by key presence: if a later run registers under the same
  // reused sessionId, this run must recognise that it is no longer the owner and stand down.
  const isSessionActive = () => activeAgentSessions.get(runId) === session && !session.isCancelled

  // One-shot session setup: task/workspace/settings resolution, model warm-up, skill matching, state restore, and the persist/watchdog closures the turn loop shares below.
  const boot = await bootstrapAgentSession({
    payload,
    session,
    sessionId,
    isSessionActive,
    deregisterSession: () => activeAgentSessions.delete(runId),
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
    codingModel,
    modelCapabilities,
    modelMetrics,
    skillMatchContext,
    skillMatchingOptions,
    skillsBlock,
    resumeValidationError,
    episodicCompactor,
    phaseController,
    goalPlanner,
    fsmMode,
    executionGuard,
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

  const phaseLabels = {
    collect_context: 'Raccolta contesto',
    propose_action: 'Proposta corrente',
    apply_action: 'Applicazione',
    verify: 'Verifica',
    outcome: 'Esito',
  } as const
  const setExecutionPhase = (phase: keyof typeof phaseLabels) => {
    phaseController.transition(phase)
    emitStepUpdate(phaseLabels[phase])
  }

  if (resumeValidationError) {
    const errorMsg = `Ripresa sessione bloccata: ${resumeValidationError}`
    emitLog('info', `❌ ${errorMsg}`)
    emitDone(false, errorMsg, 'blocked')
    await persistCurrentState('runtime_validation', 'blocked')
    clearSessionTimeout()
    setExecutionPhase('outcome')
    finalizeSession()
    return { success: false, summary: errorMsg, completionStatus: 'blocked' }
  }

  if (!workspacePath && !isStandaloneMode) {
    const errorMsg =
      'Nessuna cartella di progetto / workspace specificata. Per creare o scrivere file di progetto, seleziona o apri prima una directory di lavoro in OnlyRag.'
    emitLog('info', `❌ Errore Workspace: ${errorMsg}`)
    emitDone(false, errorMsg, 'blocked')
    await persistCurrentState('runtime_validation', 'blocked')
    clearSessionTimeout()
    setExecutionPhase('outcome')
    finalizeSession()
    return { success: false, summary: errorMsg, completionStatus: 'blocked' }
  }

  const [ollamaConnection, guestOsInfo] = await Promise.all([
    ollamaAppService.testConnection(settings.ollamaHost),
    workspaceAppService.inspectGuestOsEnvironment(),
  ])
  const preflight = evaluateAgentCodingPreflight({
    codingModel,
    availableModels,
    modelMetrics,
    ollamaReachable: ollamaConnection.success,
    ollamaError: ollamaConnection.error,
    workspacePath,
    sourceWorkspacePath: payload.sourceWorkspacePath,
    isStandaloneMode,
    toolchain: guestOsInfo.tools,
  })
  for (const check of preflight.checks) {
    emitLog('info', `${check.passed ? '✓' : check.blocking ? '✗' : '!'} Preflight ${check.id}: ${check.detail}`)
  }
  if (!preflight.ready) {
    const failures = preflight.checks
      .filter((check) => check.blocking && !check.passed)
      .map((check) => check.id)
      .join(', ')
    const errorMsg = `Agent Coding preflight blocked: ${failures}.`
    emitDone(false, errorMsg, 'blocked')
    await persistCurrentState('runtime_validation', 'blocked')
    clearSessionTimeout()
    setExecutionPhase('outcome')
    finalizeSession()
    return { success: false, summary: errorMsg, completionStatus: 'blocked' }
  }

  void ollamaAppService.preloadModel(codingModel, settings.ollamaHost).catch(() => {})

  session.changedFiles ||= []
  session.nonRollbackEffects ||= []

  const closeApplicationRun = (request: Parameters<typeof closeAgentRunFromEvidence>[1]) =>
    closeAgentRunFromEvidence(
      {
        workspacePath,
        settings,
        sessionId,
        stepCount: stepCountBox.value,
        flags: mutableFlags,
        state: responseInterpreterState,
        goalPlanner,
        episodicCompactor,
        isSessionActive,
        emitLog,
        emitDone,
        persistCurrentState,
        buildSessionTracker,
        finalizeSession,
        setExecutionPhase,
        getExecutionPhase: () => phaseController.getPhase(),
        runtimeProfile: session.ollamaRuntimeProfile,
        generationTelemetry: session.ollamaGenerationTelemetry,
        lastVerification: session.lastVerification,
        recordVerificationEvidence: (evidence) => {
          session.lastVerification = evidence
        },
        nonRollbackEffects: session.nonRollbackEffects,
        requestApproval,
        workspaceTransaction,
        signal: session.abortController?.signal,
      },
      request,
    )

  // Checkpoint cadence for the periodic (non-mutation-triggered) persistCurrentState() calls.
  const PERSIST_EVERY_N_STEPS = 5

  while (stepCountBox.value < MAX_STEPS && isSessionActive()) {
    stepCountBox.value++
    setExecutionPhase('collect_context')
    // Periodic checkpoint: persisting on every single step is unnecessary I/O churn.
    if (stepCountBox.value === 1 || stepCountBox.value % PERSIST_EVERY_N_STEPS === 0) {
      await persistCurrentState()
    }

    // Routes the turn to a model, assembles/compacts the prompt, freezes/grows num_ctx, decides Ollama context-cache reuse, and dispatches to the LLM with resilient fallback.
    const turnContext = {
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
      codingModel,
      modelCapabilities,
      modelMetrics,
      attachedContext,
      pinnedFilesContextStr,
      projectContextMapStr,
      skillMatchContext,
      skillMatchingOptions,
      skillsBlock,
      episodicCompactor,
      responseInterpreterState,
      goalPlanner,
      fsmMode,
      hasVerifiedBuild: mutableFlags.hasVerifiedBuild,
      session,
      sessionNumCtxBox,
      isSessionActive,
      emitLog,
      emitDone,
      persistCurrentState,
      finalizeSession,
      closeApplicationRun,
    }
    const hadRuntimeProfile = Boolean(session.ollamaRuntimeProfile)
    const preparedTurn = await collectTurnContext(turnContext)
    if (!hadRuntimeProfile && session.ollamaRuntimeProfile) await persistCurrentState()
    setExecutionPhase('propose_action')
    const dispatchOutcome = await requestTurnProposal(turnContext, preparedTurn)
    if (dispatchOutcome.outcome === 'return') {
      setExecutionPhase('outcome')
      return dispatchOutcome.result
    }
    const { streamedOutput, hasRecentToolFailure, errorCountInHistory, compiledHistoryBlock, targetModel } = dispatchOutcome.data

    // Interprets the raw LLM output for this turn: plan extraction, tool-call parsing (with no-tool-call / malformed-call recovery), and the finish/loop-detection/ask special cases.
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
      closeApplicationRun,
    })
    if (interpretation.outcome === 'continue') {
      setExecutionPhase('collect_context')
      continue
    }
    if (interpretation.outcome === 'return') {
      setExecutionPhase('outcome')
      return interpretation.result
    }
    const parsedTool = interpretation.parsedTool

    // Approval + FSM permission gates (strict Ask, Guided review, always-confirm commit,
    // and contextual network/install consent).
    setExecutionPhase('apply_action')
    const gateResult = await runToolGates({
      parsedTool,
      agentMode,
      fsmMode,
      workspacePath,
      stepCount: stepCountBox.value,
      episodicCompactor,
      emitLog,
      requestApproval,
      capabilityPolicyMode: settings.capabilityPolicyMode,
      allowedToolsForTurn: preparedTurn.toolPolicy.allowedTools,
      requiredReadPath: preparedTurn.toolPolicy.requiredReadPath,
      runOwnedPaths: Array.from(sessionChangedFiles.keys()),
      isIsolatedWorkspace: Boolean(workspaceTransaction),
    })
    if (gateResult.outcome === 'denied') {
      if (settings.enableCodingAgentDebugLog && gateResult.feedback) {
        codingAgentLogger.logToolResult(sessionId, stepCountBox.value, parsedTool.tool, gateResult.feedback)
      }
      setExecutionPhase('collect_context')
      continue
    }
    const versionedEdit = applyVersionedReadEvidence(gateResult.toolCallForExecution, responseInterpreterState)
    const toolCallForExecution = versionedEdit.toolCall
    if (versionedEdit.consumed) await persistCurrentState()

    // Orchestrator-level pseudo-tool: the model's explicit handle on plan progression.
    if ((parsedTool.tool as string) === 'update_plan') {
      setExecutionPhase('verify')
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
        signal: session.abortController?.signal,
      })
      setExecutionPhase('collect_context')
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
      skillsBlock,
      session.abortController?.signal,
      gateResult.policyConsent,
      sessionId,
      preparedTurn.toolPolicy.allowedTools,
      gateResult.commandApprovalGranted,
    )
    agentToolExecutorService.endJournalStep()

    if (!isSessionActive()) {
      setExecutionPhase('outcome')
      return {
        success: false,
        summary: session.terminalSummary || "Task interrotto dall'utente.",
        completionStatus: session.completionStatus || 'cancelled',
      }
    }

    setExecutionPhase('verify')
    const processingOutcome = await runToolResultProcessing({
      toolRes,
      parsedTool: toolCallForExecution,
      toolStartedAtMs,
      stepCount: stepCountBox.value,
      sessionId,
      settings,
      workspacePath,
      targetModel,
      isUnlimitedSteps,
      flags: mutableFlags,
      sessionChangedFiles,
      episodicCompactor,
      goalPlanner,
      executionGuard,
      loopDetector,
      recoveryState: responseInterpreterState,
      isSessionActive,
      rendererEvents: session.rendererEvents,
      runIdentity: identity,
      emitLog,
      emitDone,
      recordChangedFile: (filePath) => {
        if (!session.changedFiles!.includes(filePath)) session.changedFiles!.push(filePath)
      },
      recordNonRollbackEffect: (effect) => {
        if (!session.nonRollbackEffects!.includes(effect)) session.nonRollbackEffects!.push(effect)
      },
      persistCurrentState,
      finalizeSession,
      closeApplicationRun,
    })
    if (processingOutcome.outcome === 'return') {
      setExecutionPhase('outcome')
      return processingOutcome.result
    }
  }

  // Cancellation and timeout persist their own terminal checkpoint. Do not fall through to
  // the ordinary epilogue, which would overwrite that reason with a successful completion.
  if (session.isCancelled) {
    setExecutionPhase('outcome')
    return {
      success: false,
      summary: session.terminalSummary || "Task interrotto dall'utente.",
      completionStatus: session.completionStatus || 'cancelled',
    }
  }

  const budgetExhausted = stepCountBox.value >= MAX_STEPS && MAX_STEPS !== Infinity
  const closure = await closeApplicationRun({
    trigger: budgetExhausted ? 'step_budget' : 'model_silence',
    ...(budgetExhausted ? { guard: 'step_budget' as const } : {}),
    reason: budgetExhausted
      ? `Raggiunto il limite massimo di passaggi configurato (${MAX_STEPS} step).`
      : `Il ciclo dell'agente si è concluso dopo ${stepCountBox.value} passaggi.`,
  })
  return closure.outcome === 'closed'
    ? closure.result
    : { success: false, summary: 'La chiusura applicativa non ha prodotto un esito terminale.', completionStatus: 'blocked' }
}
