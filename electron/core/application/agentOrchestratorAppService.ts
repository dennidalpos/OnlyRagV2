import path from 'node:path'
import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import { logger } from '../infrastructure/logging/logger'
import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import { handleUpdatePlanTool } from './agentOrchestratorPlanTool'
import { recordToolPolicyDenial, runToolGates } from './agentOrchestratorToolGates'
import { applyVersionedReadEvidence, runToolResultProcessing } from './agentOrchestratorToolResultProcessor'
import { interpretTurnResponse } from './agentOrchestratorResponseInterpreter'
import { collectTurnContext, requestTurnProposal } from './agentOrchestratorTurnDispatch'
import { bootstrapAgentSession } from './agentOrchestratorBootstrap'
import { closeAgentRunFromEvidence } from './agentOrchestratorApplicationClosure'
import { agentToolExecutorService } from './agentToolExecutorService'
import { skillAppService } from './skillAppService'
import { taskRunner } from '../infrastructure/process/taskRunner'
import type { AgentSession } from './agentOrchestratorTypes'
import type { AgentRunContext } from './agentOrchestratorRunContext'
import { createAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'
import { matchesAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'
import type { AgentRunIdentity } from '../../../shared/types'
import { evaluateAgentCodingPreflight } from './agentCodingPreflight'
import { workspaceAppService } from './workspaceAppService'
import { ollamaAppService } from './ollamaAppService'
import { hardwareProbe } from '../infrastructure/diagnostics/hardwareProbe'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { appendToolResponse } from './agentChatTranscript'
import { restoreAgentCheckpoint } from '../infrastructure/filesystem/agentCheckpointStore'
import type { AgentChatToolCall } from '../infrastructure/http/agentStreamTransport'
import type { PreparedAgentTurn, TurnDispatchData } from './agentOrchestratorRunContext'

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
    } catch (err: unknown) {
      logger.log('WARN', 'AgentOrchestrator', `Failed cancelling active stream during cleanup: ${errorMessage(err)}`)
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
    } catch (err: unknown) {
      logger.log('WARN', 'AgentOrchestrator', `Failed terminating child process during cleanup: ${errorMessage(err)}`)
    }
    session.activeChildProcess = null
  }
  // Cancelling keeps the work on disk: undoing it is the user's explicit choice (checkpoint restore),
  // not a side effect of pressing Stop.
  let checkpointId: string | null = null
  try {
    checkpointId = agentToolExecutorService.checkpointJournal(session.workspacePath, session.id)
  } catch (err: unknown) {
    logger.log('WARN', 'AgentOrchestrator', `Failed saving the run checkpoint during cleanup: ${errorMessage(err)}`)
  }
  if (session.rendererEvents?.isAvailable()) {
    const nonRollbackEffects = [...(session.nonRollbackEffects || [])]
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
        cancellationStatus: 'kept',
        nonRollbackEffects,
        ...(checkpointId ? { checkpointId } : {}),
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

/**
 * Restores a run's checkpoint on the user's request. Refused while a run is editing the same
 * workspace, since both would write the same files.
 */
export function restoreRunCheckpoint(workspacePath: string, checkpointId: string): { success: boolean; restoredCount: number; errors: string[] } {
  const target = path.resolve(workspacePath)
  for (const session of activeAgentSessions.values()) {
    if (session.workspacePath && path.resolve(session.workspacePath) === target && !session.isCancelled) {
      return { success: false, restoredCount: 0, errors: ['An agent run is still working in this workspace; stop it before restoring.'] }
    }
  }
  return restoreAgentCheckpoint(target, checkpointId)
}

/** Applies manual prompt compaction to the next turn without altering Renderer audit logs. */
export function requestActiveAgentContextCompaction(target: AgentRunIdentity | string): boolean {
  const runId = typeof target === 'string' ? target : target.runId
  const session = activeAgentSessions.get(runId)
  if (!session || (typeof target !== 'string' && !matchesAgentRunIdentity(session.identity, target))) return false
  session.forceContextCompaction = true
  session.nativeSystemPrompt = undefined
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
    workspacePath: payload.workspacePath,
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
    matchedSkills,
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

  // No warm-up request: a preload without the session's num_ctx made Ollama load the model twice,
  // once with its default window and again at the first turn's window.
  // The context window depends on the GPU tier; before the first diagnostics run the cache is empty
  // and the host was sized as GPU-less (16k instead of 64k in the live run of 2026-09-26).
  if (!hardwareProbe.getCachedGpuInfo()) await hardwareProbe.detectGpu().catch(() => null)

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
        signal: session.abortController?.signal,
      },
      request,
    )

  const run: AgentRunContext = {
    session,
    payload,
    sessionId,
    runIdentity: identity,
    userTask,
    initialUserTask,
    agentMode,
    workspacePath,
    isStandaloneMode,
    settings,
    availableModels,
    codingModel,
    modelCapabilities,
    modelMetrics,
    attachedContext,
    pinnedFilesContextStr,
    projectContextMapStr,
    skillMatchContext,
    skillMatchingOptions,
    maxSteps: MAX_STEPS,
    maxStepsLabel,
    isUnlimitedSteps,
    flags: mutableFlags,
    state: responseInterpreterState,
    surfacedDodReasons,
    sessionChangedFiles,
    sessionNumCtxBox,
    episodicCompactor,
    goalPlanner,
    fsmMode,
    executionGuard,
    loopDetector,
    rendererEvents: session.rendererEvents,
    isSessionActive,
    emitLog,
    emitDone,
    persistCurrentState,
    finalizeSession,
    buildSessionTracker,
    closeApplicationRun,
    recordChangedFile: (filePath) => {
      if (!session.changedFiles!.includes(filePath)) session.changedFiles!.push(filePath)
    },
    recordNonRollbackEffect: (effect) => {
      if (!session.nonRollbackEffects!.includes(effect)) session.nonRollbackEffects!.push(effect)
    },
  }

  // Checkpoint cadence for the periodic (non-mutation-triggered) persistCurrentState() calls.
  const PERSIST_EVERY_N_STEPS = 5

  const pendingNativeCalls: Array<{ call: AgentChatToolCall; prepared: PreparedAgentTurn; data: TurnDispatchData }> = []
  while (stepCountBox.value < MAX_STEPS && isSessionActive()) {
    stepCountBox.value++
    setExecutionPhase('collect_context')
    // Re-fitted every turn: the manifest the skills must agree with is usually written during the run.
    const skillsBlock = skillAppService.skillsBlockForWorkspace(matchedSkills, workspacePath)
    // Periodic checkpoint: persisting on every single step is unnecessary I/O churn.
    if (stepCountBox.value === 1 || stepCountBox.value % PERSIST_EVERY_N_STEPS === 0) {
      await persistCurrentState()
    }

    // Routes the turn to a model, assembles/compacts the prompt, freezes/grows num_ctx, decides Ollama context-cache reuse, and dispatches to the LLM with resilient fallback.
    const turnContext = { ...run, stepCount: stepCountBox.value, skillsBlock }
    const pending = pendingNativeCalls.shift()
    let preparedTurn: PreparedAgentTurn
    let turnData: TurnDispatchData
    if (pending) {
      preparedTurn = pending.prepared
      turnData = { ...pending.data, nativeCalls: [pending.call] }
      setExecutionPhase('propose_action')
    } else {
      const hadRuntimeProfile = Boolean(session.ollamaRuntimeProfile)
      preparedTurn = await collectTurnContext(turnContext)
      if (!hadRuntimeProfile && session.ollamaRuntimeProfile) await persistCurrentState()
      setExecutionPhase('propose_action')
      const dispatchOutcome = await requestTurnProposal(turnContext, preparedTurn)
      if (dispatchOutcome.outcome === 'return') {
        setExecutionPhase('outcome')
        return dispatchOutcome.result
      }
      turnData = { ...dispatchOutcome.data, nativeBatchSize: dispatchOutcome.data.nativeCalls?.length }
      for (const call of turnData.nativeCalls?.slice(1) || []) pendingNativeCalls.push({ call, prepared: preparedTurn, data: turnData })
    }
    const { streamedOutput, hasRecentToolFailure, errorCountInHistory, compiledHistoryBlock, targetModel } = turnData
    const nativeCall = turnData.nativeCalls?.[0]
    const recordNativeResult = (output: string) => {
      if (nativeCall) session.chatMessages = appendToolResponse(session.chatMessages || [], nativeCall, output)
    }
    if (nativeCall && (turnData.nativeBatchSize || 0) > 1 && (nativeCall.function.name === 'finish' || nativeCall.function.name === 'ask')) {
      recordNativeResult(`${nativeCall.function.name} must be called alone after the other tool results are available.`)
      setExecutionPhase('collect_context')
      continue
    }

    // Interprets the raw LLM output for this turn: plan extraction, tool-call parsing (with no-tool-call / malformed-call recovery), and the finish/loop-detection/ask special cases.
    const interpretation = await interpretTurnResponse({
      ...run,
      streamedOutput,
      nativeCall,
      nativeMode: turnData.nativeMode,
      stepCount: stepCountBox.value,
      hasRecentToolFailure,
      errorCountInHistory,
      compiledHistoryBlock,
    })
    if (interpretation.outcome === 'continue') {
      const feedback = episodicCompactor.feedbackForStep(stepCountBox.value) ?? 'The requested action was not executed. Choose a different next step.'
      if (nativeCall) recordNativeResult(feedback)
      // A prose-only reply has no call to answer: the feedback becomes the next user message, so the
      // transcript never ends on an assistant message the model would merely continue.
      else if (turnData.nativeMode) session.chatMessages = [...(session.chatMessages || []), { role: 'user', content: feedback }]
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
    })
    if (gateResult.outcome === 'denied') {
      recordNativeResult(gateResult.feedback)
      if (settings.enableCodingAgentDebugLog && gateResult.feedback) {
        codingAgentLogger.logToolResult(sessionId, stepCountBox.value, parsedTool.tool, gateResult.feedback)
      }
      if (gateResult.policyDenial) {
        const policyStop = await recordToolPolicyDenial(responseInterpreterState, stepCountBox.value, closeApplicationRun)
        if (policyStop) {
          setExecutionPhase('outcome')
          return policyStop
        }
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
      recordNativeResult(
        episodicCompactor.feedbackForStep(stepCountBox.value) ?? 'Plan update processed. The current plan state is in the latest user message.',
      )
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
      // A call the gate substituted (a shell read run as read_file) was authorized by the gate
      // itself; re-checking it against the proposed tool's phase would deny what the gate allowed.
      toolCallForExecution.tool === parsedTool.tool
        ? preparedTurn.toolPolicy.allowedTools
        : [...preparedTurn.toolPolicy.allowedTools, toolCallForExecution.tool],
      gateResult.commandApprovalGranted,
    )
    recordNativeResult(toolRes.outputForHistory)
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
      ...run,
      toolRes,
      parsedTool: toolCallForExecution,
      toolStartedAtMs,
      stepCount: stepCountBox.value,
      targetModel,
    })
    if (processingOutcome.outcome === 'return') {
      setExecutionPhase('outcome')
      return processingOutcome.result
    }
  }

  for (const pending of pendingNativeCalls) {
    session.chatMessages = appendToolResponse(session.chatMessages || [], pending.call, 'Not executed: the run ended before this tool call.')
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
    reason: budgetExhausted ? { key: 'reasonStepBudget', params: { max: MAX_STEPS } } : { key: 'reasonLoopEnded', params: { steps: stepCountBox.value } },
  })
  return closure.outcome === 'closed'
    ? closure.result
    : { success: false, summary: 'La chiusura applicativa non ha prodotto un esito terminale.', completionStatus: 'blocked' }
}
