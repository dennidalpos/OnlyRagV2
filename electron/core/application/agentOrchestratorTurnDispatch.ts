import { OLLAMA_TOOL_SCHEMA_CATALOG } from '../domain/agent/ollamaToolSchemaCatalog'
import type { OllamaContextReuseDecision } from '../domain/agent/ollamaContextCacheManager'
import { ResilientModelDispatcher } from './resilientModelDispatcher'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { selectModelForTurn, assembleTurnPrompt, freezeOrGrowContextWindow, decideContextReuse } from './agentOrchestratorPromptAssembly'
import type { TurnDispatchContext, TurnDispatchOutcome, ModelSelection } from './agentOrchestratorTurnDispatchTypes'

export type { TurnDispatchContext, TurnDispatchData, TurnDispatchOutcome } from './agentOrchestratorTurnDispatchTypes'

async function dispatchToLlm(
  ctx: TurnDispatchContext,
  selection: ModelSelection,
  assembled: { stableSection: string; historyBlock: string },
  turnPrompt: string,
  contextReuseDecision: OllamaContextReuseDecision,
  wasCompacted: boolean
): Promise<{ streamedOutput: string } | { error: string }> {
  let lastDispatchEscalated = false
  try {
    const dispatchRes = await ResilientModelDispatcher.executeWithFallback(
      {
        primaryModel: selection.targetModel,
        intermediateModel: selection.intermediateModel,
        fallbackModel: selection.fallbackModel,
        heavyEscalationModel: selection.heavyEscalationModel,
        runtimeOpts: selection.runtimeOpts,
      },
      {
        prompt: turnPrompt,
        keepAlive: '30m',
        ollamaEndpoint: ctx.settings.ollamaHost,
        toolCallingCapable: selection.targetModelToolCallingCapable,
        toolCatalog: selection.targetModelToolCallingCapable ? OLLAMA_TOOL_SCHEMA_CATALOG : undefined,
        onTokenChunk: (chunk) => {
          if (ctx.session.targetWindow && !ctx.session.targetWindow.isDestroyed()) {
            ctx.session.targetWindow.webContents.send('agent:stream-token', { step: ctx.stepCount, chunk })
          }
        },
        isCancelled: () => !ctx.isSessionActive(),
        onHttpRequestCreated: (req) => {
          ctx.session.activeHttpRequest = req
        },
        onContextReceived: (contextTokens, respondingModel) => {
          // Only cache when this turn's prompt matched assembled.stableSection/historyBlock
          // exactly — HeuristicContextCompactor rewrites that structure on compaction, so the
          // returned tokens wouldn't correspond to the cached baseline shape (AGT1).
          if (wasCompacted) return
          ctx.session.ollamaContextTokens = contextTokens
          ctx.session.ollamaContextModel = respondingModel
          ctx.session.ollamaContextStableSection = assembled.stableSection
          ctx.session.ollamaContextHistoryBlock = assembled.historyBlock
        },
      },
      (fromModel, toModel, reason) => {
        const isHeavy = toModel === selection.heavyEscalationModel
        lastDispatchEscalated = isHeavy
        const label = isHeavy ? '🔺 Heavy Tier Escalation' : '⚡ Resilient Fallback'
        ctx.emitLog('info', `${label}: ${fromModel} → ${toModel}`, `Triggered: ${reason}`)
      },
      contextReuseDecision.reusedContext
        ? { prompt: contextReuseDecision.promptToSend, previousContext: contextReuseDecision.contextTokens! }
        : undefined
    )
    if (dispatchRes.isEscalated || lastDispatchEscalated) {
      ctx.emitLog('info', `🔺 Heavy Tier active (${dispatchRes.usedModel}): VRAM eviction applied before escalation.`)
    }
    ctx.session.activeHttpRequest = null
    return { streamedOutput: dispatchRes.output }
  } catch (err: any) {
    return { error: err.message }
  }
}

/**
 * Routes the turn to a model, assembles and (if needed) compacts the prompt, freezes/grows the
 * session's num_ctx, decides Ollama context-cache reuse (see agentOrchestratorPromptAssembly.ts
 * for all of the above), and dispatches to the LLM with resilient fallback. Mirrors the exact
 * step order from the original inline loop body.
 */
export async function runTurnDispatch(ctx: TurnDispatchContext): Promise<TurnDispatchOutcome> {
  const hasRecentToolFailure = ctx.episodicCompactor.failureCount > 0
  const errorCountInHistory = ctx.episodicCompactor.failureCount
  const compiledHistoryBlock = ctx.episodicCompactor.compilePromptHistoryBlock(10000)

  const selection = selectModelForTurn(ctx, hasRecentToolFailure, errorCountInHistory)
  const { assembled, compactionResult, turnPrompt } = await assembleTurnPrompt(ctx, selection, compiledHistoryBlock)
  freezeOrGrowContextWindow(ctx, turnPrompt, selection.runtimeOpts)

  ctx.emitLog(
    'tool_call',
    `[Step ${ctx.stepCount}/${ctx.maxStepsLabel}] Consulting LLM (${selection.targetModel}) [ctx:${selection.runtimeOpts.num_ctx}${
      ctx.fsmMode.getMode() !== 'AGENT' ? ` | Mode:${ctx.fsmMode.getMode()}` : ''
    }]...`
  )
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logTurnPrompt(ctx.sessionId, ctx.stepCount, selection.targetModel, selection.runtimeOpts.num_ctx, turnPrompt)
  }

  const contextReuseDecision = decideContextReuse(ctx, selection, assembled, turnPrompt, compactionResult.wasCompacted)
  const dispatchResult = await dispatchToLlm(ctx, selection, assembled, turnPrompt, contextReuseDecision, compactionResult.wasCompacted)

  if ('error' in dispatchResult) {
    ctx.emitLog('info', `LLM Stream error on step ${ctx.stepCount}: ${dispatchResult.error}`)
    ctx.emitDone(false, `LLM Stream Error: ${dispatchResult.error}`)
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, false, `LLM Error: ${dispatchResult.error}`)
    }
    agentToolExecutorService.rollbackJournal()
    await ctx.persistCurrentState()
    ctx.finalizeSession()
    return { outcome: 'return', result: { success: false, summary: `LLM Error: ${dispatchResult.error}` } }
  }

  if (!ctx.isSessionActive()) {
    ctx.emitLog('info', 'Agent execution cancelled by user.')
    ctx.emitDone(false, 'Task cancelled by user.')
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, false, 'Task cancelled by user.')
    }
    agentToolExecutorService.rollbackJournal()
    await ctx.persistCurrentState()
    ctx.finalizeSession()
    return { outcome: 'return', result: { success: false, summary: 'Task cancelled' } }
  }

  ctx.emitLog('info', `AI Agent (${ctx.agentMode.toUpperCase()} Step ${ctx.stepCount}):`, dispatchResult.streamedOutput)
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logLlmResponse(ctx.sessionId, ctx.stepCount, dispatchResult.streamedOutput)
  }

  return {
    outcome: 'proceed',
    data: {
      streamedOutput: dispatchResult.streamedOutput,
      hasRecentToolFailure,
      errorCountInHistory,
      compiledHistoryBlock,
      targetModel: selection.targetModel,
      intermediateModel: selection.intermediateModel,
      fallbackModel: selection.fallbackModel,
      heavyEscalationModel: selection.heavyEscalationModel,
    },
  }
}
