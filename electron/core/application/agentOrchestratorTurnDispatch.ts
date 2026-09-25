import { selectToolSchemas } from '../domain/agent/ollamaToolSchemaCatalog'
import { AgentStreamTransport } from '../infrastructure/http/agentStreamTransport'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { selectModelForTurn, assembleTurnPrompt, freezeContextWindow, decideContextReuse } from './agentOrchestratorPromptAssembly'
import type { PreparedAgentTurn, TurnDispatchContext, TurnDispatchOutcome, ModelSelection } from './agentOrchestratorRunContext'
import { emitLocalizedLog } from './agentOrchestratorTypes'
import type { TurnToolPolicy } from '../domain/agent/turnToolPolicy'
import { recordRecoveryFailure, recoveryStopDiagnostic, type RecoveryFailureState } from '../domain/agent/recoveryBudget'
import { CODING_MODEL_KEEP_ALIVE } from '../domain/agent/hardwareProfileResolver'
import { enrichOllamaGenerationTelemetry, type OllamaStreamTelemetry } from '../domain/agent/ollamaSessionRuntime'
import { ollamaAppService } from './ollamaAppService'
import { calculateAvailableOutputTokens, countPromptTokens } from '../../../shared/domain/agent/contextWindowCalculator'
import { resolveOllamaThinkingPreference } from '../../../shared/domain/agent/ollamaThinkingPolicy'
import { appendAssistantTurn, boundedChatMessages } from './agentChatTranscript'
import type { AgentChatTurn } from '../infrastructure/http/agentStreamTransport'

async function dispatchToLlm(
  ctx: TurnDispatchContext,
  selection: ModelSelection,
  assembled: PreparedAgentTurn['assembled'],
  turnPrompt: string,
  wasCompacted: boolean,
  toolPolicy: TurnToolPolicy,
): Promise<{ streamedOutput: string; nativeTurn?: AgentChatTurn; usedModel?: string } | { error: string }> {
  let generationTelemetry: OllamaStreamTelemetry | undefined
  const toolCatalog = selectToolSchemas(toolPolicy.allowedTools)
  const schemaTokens = countPromptTokens(JSON.stringify(toolCatalog))
  const maxPromptTokens = Math.max(1, selection.runtimeOpts.num_ctx - schemaTokens - 1024 - 256)
  const corePrompt = [assembled.segments.baseSystemPrompt, assembled.segments.planSection, assembled.segments.skillsSection, assembled.turnSuffix]
    .filter(Boolean)
    .join('\n\n')
  const chat = boundedChatMessages(
    corePrompt,
    [assembled.segments.pinnedBlock, assembled.segments.activeFileBlock, assembled.segments.attachedBlock, assembled.segments.mapBlock],
    ctx.userTask,
    ctx.session.chatMessages || [],
    maxPromptTokens,
    wasCompacted || ctx.session.forceContextCompaction,
  )
  const outputCapacity = selection.runtimeOpts.num_ctx - schemaTokens - countPromptTokens(JSON.stringify(chat.messages)) - 256
  if (outputCapacity < 512) return { error: `Ollama chat context exceeds the ${selection.runtimeOpts.num_ctx}-token hardware budget.` }
  selection.runtimeOpts.num_predict = Math.min(selection.runtimeOpts.num_predict, outputCapacity)
  ctx.session.chatMessages = chat.retainedHistory
  const stream = () =>
    AgentStreamTransport.streamCompletion({
      targetModel: selection.targetModel,
      prompt: turnPrompt,
      runtimeOpts: selection.runtimeOpts,
      keepAlive: CODING_MODEL_KEEP_ALIVE,
      ollamaEndpoint: ctx.settings.ollamaHost,
      toolCallingCapable: true,
      toolCatalog,
      messages: chat.messages,
      onTokenChunk: (chunk) => {
        if (ctx.isSessionActive() && ctx.session.rendererEvents?.isAvailable()) {
          ctx.session.rendererEvents.send('agent:stream-token', { ...ctx.session.identity, step: ctx.stepCount, chunk })
        }
      },
      onThoughtChunk: (chunk) => {
        if (ctx.isSessionActive() && ctx.session.rendererEvents?.isAvailable()) {
          ctx.session.rendererEvents.send('agent:stream-thought', { ...ctx.session.identity, step: ctx.stepCount, chunk })
        }
      },
      think: resolveOllamaThinkingPreference(selection.targetModel, ctx.settings, ctx.modelMetrics).think,
      isCancelled: () => !ctx.isSessionActive(),
      signal: ctx.session.abortController?.signal,
      onCancelHandle: (abort) => {
        ctx.session.activeCancelHandle = abort
      },
      onGenerationTelemetry: (telemetry) => {
        generationTelemetry = telemetry
      },
    })
  let transportFailure: RecoveryFailureState | undefined
  while (true) {
    try {
      const response = await stream()
      ctx.session.activeCancelHandle = null
      const nativeTurn = typeof response === 'string' ? undefined : response
      if (nativeTurn) ctx.session.chatMessages = appendAssistantTurn(ctx.session.chatMessages || [], nativeTurn)
      if (generationTelemetry) {
        const running = await ollamaAppService.getRunningModels(ctx.settings.ollamaHost)
        const loaded = running.models.find((model) => model.name === selection.targetModel || model.model === selection.targetModel)
        ctx.session.ollamaGenerationTelemetry = [
          ...(ctx.session.ollamaGenerationTelemetry || []),
          enrichOllamaGenerationTelemetry(generationTelemetry, ctx.stepCount, loaded),
        ].slice(-200)
      }
      return { streamedOutput: nativeTurn?.content ?? String(response), nativeTurn, usedModel: selection.targetModel }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.session.activeCancelHandle = null
      if (!ctx.isSessionActive()) return { error: message }

      const fatal = /not pulled|not reachable|not running/i.test(message)
      if (fatal) return { error: message }

      const signature = message.toLowerCase().replace(/\d+/g, '#').slice(0, 240)
      const decision = recordRecoveryFailure(transportFailure, signature)
      transportFailure = decision.state
      if (decision.action === 'stop') {
        return { error: `${recoveryStopDiagnostic('transport', decision.state)} Last error: ${message}` }
      }

      emitLocalizedLog(ctx.emitLog, 'info', { key: 'transportRecovery', params: { error: message } })
    }
  }
}

/** Collects the bounded context and runtime facts before the model is consulted. */
export async function collectTurnContext(ctx: TurnDispatchContext): Promise<PreparedAgentTurn> {
  const hasRecentToolFailure = ctx.episodicCompactor.failureCount > 0
  const errorCountInHistory = ctx.episodicCompactor.failureCount
  const compiledHistoryBlock = ctx.episodicCompactor.compilePromptHistoryBlock(ctx.session.forceContextCompaction ? 4000 : 10000)

  const selection = selectModelForTurn(ctx)
  freezeContextWindow(ctx, selection.runtimeOpts)
  const { assembled, compactionResult, turnPrompt, toolPolicy } = await assembleTurnPrompt(ctx, selection, compiledHistoryBlock)
  selection.runtimeOpts.num_predict = calculateAvailableOutputTokens(turnPrompt, selection.runtimeOpts.num_ctx)
  if (ctx.session.ollamaRuntimeProfile?.model === selection.targetModel) {
    ctx.session.ollamaRuntimeProfile.options.num_predict = selection.runtimeOpts.num_predict
  }

  if (ctx.isSessionActive() && ctx.session.rendererEvents?.isAvailable()) {
    const promptTokens = countPromptTokens(turnPrompt)
    const promptBudgetTokens = Math.max(1, selection.runtimeOpts.num_ctx - selection.runtimeOpts.num_predict)
    ctx.session.rendererEvents.send('agent:context-budget', {
      ...ctx.session.identity,
      model: selection.targetModel,
      contextWindowTokens: selection.runtimeOpts.num_ctx,
      outputReserveTokens: selection.runtimeOpts.num_predict,
      promptBudgetTokens,
      originalPromptTokens: countPromptTokens(assembled.prompt),
      promptTokens,
      utilizationPercent: Math.min(100, Math.round((promptTokens / promptBudgetTokens) * 100)),
      wasCompacted: compactionResult.wasCompacted,
      manualCompaction: Boolean(ctx.session.forceContextCompaction),
    })
  }

  const contextReuseDecision = decideContextReuse(ctx, selection, assembled, turnPrompt, compactionResult.wasCompacted)
  return {
    selection,
    assembled,
    turnPrompt,
    contextReuseDecision,
    wasCompacted: compactionResult.wasCompacted,
    hasRecentToolFailure,
    errorCountInHistory,
    compiledHistoryBlock,
    toolPolicy,
  }
}

/** Requests exactly one current-turn proposal from the selected model. */
export async function requestTurnProposal(ctx: TurnDispatchContext, prepared: PreparedAgentTurn): Promise<TurnDispatchOutcome> {
  const { selection, assembled, turnPrompt, wasCompacted, toolPolicy } = prepared
  ctx.emitLog(
    'tool_call',
    `[Step ${ctx.stepCount}/${ctx.maxStepsLabel}] Consulting LLM (${selection.targetModel}) [ctx:${selection.runtimeOpts.num_ctx}${
      ctx.fsmMode.getMode() !== 'AUTO' ? ` | Mode:${ctx.fsmMode.getMode()}` : ''
    }]...`,
  )
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logTurnPrompt(ctx.sessionId, ctx.stepCount, selection.targetModel, selection.runtimeOpts.num_ctx, turnPrompt)
  }

  const dispatchResult = await dispatchToLlm(ctx, selection, assembled, turnPrompt, wasCompacted, toolPolicy)

  if (!ctx.isSessionActive()) {
    const completionStatus = ctx.session.completionStatus || 'cancelled'
    const terminalSummary = ctx.session.terminalSummary || 'Task cancelled by user.'
    ctx.emitLog('info', terminalSummary)
    ctx.emitDone(false, terminalSummary, completionStatus)
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, false, 'Task cancelled by user.')
    }
    agentToolExecutorService.rollbackJournal()
    ctx.finalizeSession()
    return { outcome: 'return', result: { success: false, summary: terminalSummary, completionStatus } }
  }

  if ('error' in dispatchResult) {
    emitLocalizedLog(ctx.emitLog, 'info', { key: 'llmStreamError', params: { step: ctx.stepCount, error: dispatchResult.error } })
    const closure = await ctx.closeApplicationRun({
      trigger: 'transport_error',
      guard: 'transport_budget',
      reason: { key: 'reasonTransportError', params: { step: ctx.stepCount, error: dispatchResult.error } },
    })
    return {
      outcome: 'return',
      result: closure.outcome === 'closed' ? closure.result : { success: false, summary: `LLM Error: ${dispatchResult.error}`, completionStatus: 'blocked' },
    }
  }

  const effectiveUsedModel = dispatchResult.usedModel || selection.targetModel

  emitLocalizedLog(
    ctx.emitLog,
    'info',
    { key: 'agentThoughtHeader', params: { mode: ctx.agentMode.toUpperCase(), step: ctx.stepCount } },
    dispatchResult.streamedOutput,
    { category: 'agent_thought', modelName: effectiveUsedModel },
  )
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logLlmResponse(ctx.sessionId, ctx.stepCount, dispatchResult.streamedOutput)
  }

  return {
    outcome: 'proceed',
    data: {
      streamedOutput: dispatchResult.streamedOutput,
      nativeCalls: dispatchResult.nativeTurn?.toolCalls,
      nativeMode: Boolean(dispatchResult.nativeTurn),
      hasRecentToolFailure: prepared.hasRecentToolFailure,
      errorCountInHistory: prepared.errorCountInHistory,
      compiledHistoryBlock: prepared.compiledHistoryBlock,
      targetModel: effectiveUsedModel,
    },
  }
}
