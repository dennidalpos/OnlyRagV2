import { selectToolSchemas } from '../domain/agent/ollamaToolSchemaCatalog'
import type { OllamaContextReuseDecision } from '../domain/agent/ollamaContextCacheManager'
import { AgentStreamTransport } from '../infrastructure/http/agentStreamTransport'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { selectModelForTurn, assembleTurnPrompt, freezeContextWindow, decideContextReuse } from './agentOrchestratorPromptAssembly'
import type {
  PreparedAgentTurn,
  TurnDispatchContext,
  TurnDispatchOutcome,
  ModelSelection,
} from './agentOrchestratorTurnDispatchTypes'
import type { TurnToolPolicy } from '../domain/agent/turnToolPolicy'
import {
  recordRecoveryFailure,
  recoveryStopDiagnostic,
  type RecoveryFailureState,
} from '../domain/agent/recoveryBudget'
import { CODING_MODEL_KEEP_ALIVE } from '../domain/agent/hardwareProfileResolver'

export type { TurnDispatchContext, TurnDispatchOutcome } from './agentOrchestratorTurnDispatchTypes'

async function dispatchToLlm(
  ctx: TurnDispatchContext,
  selection: ModelSelection,
  assembled: { stableSection: string; historyBlock: string },
  turnPrompt: string,
  contextReuseDecision: OllamaContextReuseDecision,
  wasCompacted: boolean,
  toolPolicy: TurnToolPolicy
): Promise<{ streamedOutput: string; usedModel?: string } | { error: string }> {
  const latchProtocol = (protocol: 'native' | 'text') => {
    ctx.session.toolCallingProtocolByModel = {
      ...ctx.session.toolCallingProtocolByModel,
      [selection.targetModel]: protocol,
    }
  }
  const stream = (toolCallingCapable: boolean) => AgentStreamTransport.streamCompletion({
    targetModel: selection.targetModel,
    prompt: contextReuseDecision.reusedContext ? contextReuseDecision.promptToSend : turnPrompt,
    runtimeOpts: selection.runtimeOpts,
    keepAlive: CODING_MODEL_KEEP_ALIVE,
    ollamaEndpoint: ctx.settings.ollamaHost,
    toolCallingCapable,
    toolCatalog: toolCallingCapable ? selectToolSchemas(toolPolicy.allowedTools) : undefined,
    previousContext: contextReuseDecision.reusedContext ? contextReuseDecision.contextTokens : undefined,
    onTokenChunk: (chunk) => {
      if (ctx.session.targetWindow && !ctx.session.targetWindow.isDestroyed()) {
        ctx.session.targetWindow.webContents.send('agent:stream-token', { step: ctx.stepCount, chunk })
      }
    },
    onThoughtChunk: (chunk) => {
      if (ctx.session.targetWindow && !ctx.session.targetWindow.isDestroyed()) {
        ctx.session.targetWindow.webContents.send('agent:stream-thought', { step: ctx.stepCount, chunk })
      }
    },
    isCancelled: () => !ctx.isSessionActive(),
    onCancelHandle: (abort) => { ctx.session.activeCancelHandle = abort },
    onToolProtocolObserved: selection.targetModelToolCallingProbe ? latchProtocol : undefined,
    onContextReceived: (contextTokens, respondingModel) => {
      if (wasCompacted) return
      ctx.session.ollamaContextTokens = contextTokens
      ctx.session.ollamaContextModel = respondingModel
      ctx.session.ollamaContextStableSection = assembled.stableSection
      ctx.session.ollamaContextHistoryBlock = assembled.historyBlock
    },
  })
  let transportFailure: RecoveryFailureState | undefined
  let toolCallingCapable = selection.targetModelToolCallingCapable
  while (true) {
    try {
      const streamedOutput = await stream(toolCallingCapable)
      ctx.session.activeCancelHandle = null
      return { streamedOutput, usedModel: selection.targetModel }
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

      if (selection.targetModelToolCallingProbe && toolCallingCapable) {
        latchProtocol('text')
        toolCallingCapable = false
      }
      ctx.emitLog('info', `Recupero trasporto Ollama 1/1 dopo: ${message}`)
    }
  }
}

/** Collects the bounded context and runtime facts before the model is consulted. */
export async function collectTurnContext(ctx: TurnDispatchContext): Promise<PreparedAgentTurn> {
  const hasRecentToolFailure = ctx.episodicCompactor.failureCount > 0
  const errorCountInHistory = ctx.episodicCompactor.failureCount
  const compiledHistoryBlock = ctx.episodicCompactor.compilePromptHistoryBlock(10000)

  const selection = selectModelForTurn(ctx)
  freezeContextWindow(ctx, selection.runtimeOpts)
  const { assembled, compactionResult, turnPrompt, toolPolicy } = await assembleTurnPrompt(ctx, selection, compiledHistoryBlock)

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
export async function requestTurnProposal(
  ctx: TurnDispatchContext,
  prepared: PreparedAgentTurn
): Promise<TurnDispatchOutcome> {
  const { selection, assembled, turnPrompt, contextReuseDecision, wasCompacted, toolPolicy } = prepared
  ctx.emitLog(
    'tool_call',
    `[Step ${ctx.stepCount}/${ctx.maxStepsLabel}] Consulting LLM (${selection.targetModel}) [ctx:${selection.runtimeOpts.num_ctx}${
      ctx.fsmMode.getMode() !== 'AGENT' ? ` | Mode:${ctx.fsmMode.getMode()}` : ''
    }]...`
  )
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logTurnPrompt(ctx.sessionId, ctx.stepCount, selection.targetModel, selection.runtimeOpts.num_ctx, turnPrompt)
  }

  const dispatchResult = await dispatchToLlm(ctx, selection, assembled, turnPrompt, contextReuseDecision, wasCompacted, toolPolicy)

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
    ctx.emitLog('info', `LLM Stream error on step ${ctx.stepCount}: ${dispatchResult.error}`)
    const closure = await ctx.closeApplicationRun({
      trigger: 'transport_error',
      reason: `Errore di trasporto LLM al passo ${ctx.stepCount}: ${dispatchResult.error}`,
    })
    return {
      outcome: 'return',
      result: closure.outcome === 'closed'
        ? closure.result
        : { success: false, summary: `LLM Error: ${dispatchResult.error}`, completionStatus: 'blocked' },
    }
  }

  const effectiveUsedModel = dispatchResult.usedModel || selection.targetModel

  ctx.emitLog('info', `AI Agent (${ctx.agentMode.toUpperCase()} Step ${ctx.stepCount}):`, dispatchResult.streamedOutput, {
    category: 'agent_thought',
    modelName: effectiveUsedModel,
  })
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logLlmResponse(ctx.sessionId, ctx.stepCount, dispatchResult.streamedOutput)
  }

  return {
    outcome: 'proceed',
    data: {
      streamedOutput: dispatchResult.streamedOutput,
      hasRecentToolFailure: prepared.hasRecentToolFailure,
      errorCountInHistory: prepared.errorCountInHistory,
      compiledHistoryBlock: prepared.compiledHistoryBlock,
      targetModel: effectiveUsedModel,
    },
  }
}
