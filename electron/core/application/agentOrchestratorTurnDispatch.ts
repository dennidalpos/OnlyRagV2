import { selectToolSchemas } from '../domain/agent/ollamaToolSchemaCatalog'
import { AgentStreamTransport, DEFAULT_STREAM_STALL_MS } from '../infrastructure/http/agentStreamTransport'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { selectModelForTurn, assembleTurnPrompt, freezeContextWindow } from './agentOrchestratorPromptAssembly'
import type { PreparedAgentTurn, TurnDispatchContext, TurnDispatchOutcome, ModelSelection } from './agentOrchestratorRunContext'
import { emitLocalizedLog } from './agentOrchestratorTypes'
import type { TurnToolPolicy } from '../domain/agent/turnToolPolicy'
import { recordRecoveryFailure, recoveryStopDiagnostic, type RecoveryFailureState } from '../domain/agent/recoveryBudget'
import { CODING_MODEL_KEEP_ALIVE } from '../domain/agent/hardwareProfileResolver'
import { enrichOllamaGenerationTelemetry, type OllamaStreamTelemetry } from '../domain/agent/ollamaSessionRuntime'
import { ollamaAppService } from './ollamaAppService'
import { countPromptTokens } from '../../../shared/domain/agent/contextWindowCalculator'
import { resolveAgentThinkValue } from '../../../shared/domain/agent/ollamaThinkingPolicy'
import { appendAssistantTurn, buildChatRequest, composeSessionSystemPrompt } from './agentChatTranscript'
import type { AgentChatMessage, AgentChatTurn } from '../infrastructure/http/agentStreamTransport'

/** Largest share of the prompt budget the frozen system message may take with its optional context sections. */
const SYSTEM_PROMPT_BUDGET_SHARE = 0.45
/** Below this, a turn cannot hold a file write plus a short thought; the request is refused instead. */
const MIN_OUTPUT_TOKENS = 1024

/** Output room held back from the prompt budget: a quarter of the window, between 2k and 16k tokens. */
function outputReserveTokens(numCtx: number): number {
  return Math.min(16384, Math.max(2048, Math.floor(numCtx * 0.25)))
}

/**
 * The local tokenizer (o200k over the JSON messages) is only an estimate of the model's tokenizer. When
 * Ollama reported more prompt tokens than estimated on the previous turn, later estimates are scaled
 * up by that ratio (never down, at most 1.5x), so the output budget is never computed from an optimistic count.
 */
function calibratedPromptTokens(ctx: TurnDispatchContext, messages: readonly AgentChatMessage[]): number {
  const estimate = countPromptTokens(JSON.stringify(messages))
  const ratio = ctx.session.promptTokenRatio ?? 1
  ctx.session.lastPromptTokenEstimate = estimate
  return Math.ceil(estimate * ratio)
}

/** Output a long tool call (a whole file) may take, used to size the stream's silence limit. */
const TOOL_CALL_TOKEN_ALLOWANCE = 4096
const MAX_STREAM_STALL_MS = 30 * 60 * 1000

/**
 * Ollama withholds a tool call's text until the call is complete, so a model writing a large file
 * sends nothing for minutes. A fixed 5-minute limit killed such a turn twice (qwen3-coder:30b at
 * 3.95 tokens/s, 1193 tokens, live run of 2026-09-26). The limit follows the speed this model
 * actually showed in this session: long enough for TOOL_CALL_TOKEN_ALLOWANCE tokens, within 5-30 min.
 */
export function streamStallTimeoutMs(telemetry: readonly { completionTokens?: number; evalDurationMs?: number }[] | undefined): number {
  const measured = [...(telemetry || [])].reverse().find((entry) => (entry.completionTokens ?? 0) >= 20 && (entry.evalDurationMs ?? 0) > 0)
  if (!measured) return 10 * 60 * 1000
  const tokensPerSecond = (measured.completionTokens as number) / ((measured.evalDurationMs as number) / 1000)
  return Math.min(MAX_STREAM_STALL_MS, Math.max(DEFAULT_STREAM_STALL_MS, Math.ceil((TOOL_CALL_TOKEN_ALLOWANCE / tokensPerSecond) * 1000)))
}

/** The chat request as the debug log records it: the transcript in order, then this turn's tool names (last, so consecutive turns share a prefix the log can elide). */
function renderChatRequestForLog(messages: readonly AgentChatMessage[], toolNames: readonly string[]): string {
  const rendered = messages.map((message) => {
    const header = `### ${message.role}${message.tool_name ? ` (${message.tool_name})` : ''}`
    const calls = message.tool_calls?.length ? `\n[tool_calls] ${JSON.stringify(message.tool_calls)}` : ''
    return `${header}\n${message.content}${calls}`
  })
  return [...rendered, `### tools\n${toolNames.join(', ')}`].join('\n\n')
}

/** Model-output failures the model can fix itself: sent back as feedback instead of retried verbatim. */
function modelOutputCorrection(errorMessage: string): string | null {
  if (/incomplete \(length\)/i.test(errorMessage)) {
    return [
      '[APPLICATION FEEDBACK] Your previous response reached the output token limit before a complete tool call was produced, so nothing was executed.',
      'Keep reasoning short. Write large files in parts: write_file a first section, then extend it with replace_file_content.',
    ].join('\n')
  }
  const invalidArguments = errorMessage.match(/Invalid Ollama tool arguments: (.*)/i)
  if (invalidArguments) {
    return `[APPLICATION FEEDBACK] Your previous tool call was not executed: its arguments were not a valid JSON object (${invalidArguments[1].slice(0, 200)}). Call the tool again with a JSON object matching its schema.`
  }
  return null
}

async function dispatchToLlm(
  ctx: TurnDispatchContext,
  selection: ModelSelection,
  assembled: PreparedAgentTurn['assembled'],
  toolPolicy: TurnToolPolicy,
): Promise<{ nativeTurn: AgentChatTurn; usedModel: string } | { error: string }> {
  let generationTelemetry: OllamaStreamTelemetry | undefined
  const toolCatalog = selectToolSchemas(toolPolicy.allowedTools)
  const schemaTokens = countPromptTokens(JSON.stringify(toolCatalog))
  const numCtx = selection.runtimeOpts.num_ctx
  const maxPromptTokens = Math.max(1, numCtx - schemaTokens - outputReserveTokens(numCtx))
  // The system message is composed once per session (see composeSessionSystemPrompt): a per-turn
  // rebuild made Ollama re-evaluate the whole prompt every step (91 s for 13k tokens on 2026-09-25).
  if (!ctx.session.nativeSystemPrompt) {
    const systemCore = [assembled.segments.baseSystemPrompt, assembled.segments.skillsSection].filter((part) => part.trim()).join('\n\n')
    ctx.session.nativeSystemPrompt = composeSessionSystemPrompt(
      systemCore,
      [assembled.segments.pinnedBlock, assembled.segments.activeFileBlock, assembled.segments.attachedBlock, assembled.segments.mapBlock],
      Math.floor(maxPromptTokens * SYSTEM_PROMPT_BUDGET_SHARE),
    )
  }
  const turnContext = [assembled.segments.planSection, assembled.turnSuffix].filter((part) => part.trim()).join('\n\n')
  const chat = buildChatRequest({
    systemPrompt: ctx.session.nativeSystemPrompt,
    userTask: ctx.initialUserTask,
    history: ctx.session.chatMessages || [],
    turnContext,
    maxPromptTokens,
    forceCompact: ctx.session.forceContextCompaction,
  })
  const manualCompaction = Boolean(ctx.session.forceContextCompaction)
  ctx.session.forceContextCompaction = false
  const promptTokens = schemaTokens + calibratedPromptTokens(ctx, chat.messages)
  // num_predict takes whatever the window has left: a thinking model needs room to reason and still
  // emit the call, and a cap at the window edge avoids Ollama's context shift mid-generation.
  const outputCapacity = numCtx - promptTokens - 256
  if (outputCapacity < MIN_OUTPUT_TOKENS) return { error: `Ollama chat context exceeds the ${numCtx}-token window.` }
  selection.runtimeOpts.num_predict = outputCapacity
  ctx.session.chatMessages = chat.retainedHistory
  if (ctx.settings.enableCodingAgentDebugLog) {
    const toolNames = toolCatalog.map((tool) => tool.function.name)
    codingAgentLogger.logTurnPrompt(ctx.sessionId, ctx.stepCount, selection.targetModel, numCtx, renderChatRequestForLog(chat.messages, toolNames))
  }
  if (ctx.isSessionActive() && ctx.session.rendererEvents?.isAvailable()) {
    const promptBudgetTokens = Math.max(1, numCtx - outputReserveTokens(numCtx))
    ctx.session.rendererEvents.send('agent:context-budget', {
      ...ctx.session.identity,
      model: selection.targetModel,
      contextWindowTokens: numCtx,
      outputReserveTokens: outputCapacity,
      promptBudgetTokens,
      originalPromptTokens: schemaTokens + countPromptTokens(JSON.stringify([...(ctx.session.chatMessages || []), ...chat.messages.slice(0, 2)])),
      promptTokens,
      utilizationPercent: Math.min(100, Math.round((promptTokens / promptBudgetTokens) * 100)),
      wasCompacted: chat.trimmed,
      manualCompaction,
    })
  }
  const stream = () =>
    AgentStreamTransport.streamCompletion({
      targetModel: selection.targetModel,
      runtimeOpts: selection.runtimeOpts,
      keepAlive: CODING_MODEL_KEEP_ALIVE,
      ollamaEndpoint: ctx.settings.ollamaHost,
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
      think: resolveAgentThinkValue(selection.targetModel, ctx.settings, ctx.modelMetrics),
      isCancelled: () => !ctx.isSessionActive(),
      signal: ctx.session.abortController?.signal,
      onCancelHandle: (abort) => {
        ctx.session.activeCancelHandle = abort
      },
      onGenerationTelemetry: (telemetry) => {
        generationTelemetry = telemetry
      },
      stallTimeoutMs: streamStallTimeoutMs(ctx.session.ollamaGenerationTelemetry),
    })
  let transportFailure: RecoveryFailureState | undefined
  while (true) {
    try {
      const nativeTurn = await stream()
      ctx.session.activeCancelHandle = null
      ctx.session.chatMessages = appendAssistantTurn(ctx.session.chatMessages || [], nativeTurn)
      if (generationTelemetry) {
        const estimate = ctx.session.lastPromptTokenEstimate
        const reported = generationTelemetry.promptTokens
        if (estimate && reported && reported > estimate) ctx.session.promptTokenRatio = Math.min(1.5, reported / estimate)
        const running = await ollamaAppService.getRunningModels(ctx.settings.ollamaHost)
        const loaded = running.models.find((model) => model.name === selection.targetModel || model.model === selection.targetModel)
        ctx.session.ollamaGenerationTelemetry = [
          ...(ctx.session.ollamaGenerationTelemetry || []),
          enrichOllamaGenerationTelemetry(generationTelemetry, ctx.stepCount, loaded),
        ].slice(-200)
      }
      return { nativeTurn, usedModel: selection.targetModel }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.session.activeCancelHandle = null
      if (!ctx.isSessionActive()) return { error: message }

      const fatal = /not pulled|not reachable|not running/i.test(message)
      if (fatal) return { error: message }

      const correction = modelOutputCorrection(message)
      if (correction) {
        const feedback: AgentChatMessage = { role: 'user', content: correction }
        ctx.session.chatMessages = [...(ctx.session.chatMessages || []), feedback]
        // Appended, like everything in the transcript, so the retry still extends the cached prefix.
        chat.messages.push(feedback)
      }

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
  const { assembled, toolPolicy } = await assembleTurnPrompt(ctx, selection)
  return {
    selection,
    assembled,
    hasRecentToolFailure,
    errorCountInHistory,
    compiledHistoryBlock,
    toolPolicy,
  }
}

/** Requests exactly one current-turn proposal from the selected model. */
export async function requestTurnProposal(ctx: TurnDispatchContext, prepared: PreparedAgentTurn): Promise<TurnDispatchOutcome> {
  const { selection, assembled, toolPolicy } = prepared
  ctx.emitLog(
    'tool_call',
    `[Step ${ctx.stepCount}/${ctx.maxStepsLabel}] Consulting LLM (${selection.targetModel}) [ctx:${selection.runtimeOpts.num_ctx}${
      ctx.fsmMode.getMode() !== 'AUTO' ? ` | Mode:${ctx.fsmMode.getMode()}` : ''
    }]...`,
  )
  const dispatchResult = await dispatchToLlm(ctx, selection, assembled, toolPolicy)

  if (!ctx.isSessionActive()) {
    const completionStatus = ctx.session.completionStatus || 'cancelled'
    const terminalSummary = ctx.session.terminalSummary || 'Task cancelled by user.'
    ctx.emitLog('info', terminalSummary)
    ctx.emitDone(false, terminalSummary, completionStatus)
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, false, 'Task cancelled by user.')
    }
    agentToolExecutorService.checkpointJournal(ctx.workspacePath, ctx.sessionId)
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

  const effectiveUsedModel = dispatchResult.usedModel
  const streamedOutput = dispatchResult.nativeTurn.content

  emitLocalizedLog(ctx.emitLog, 'info', { key: 'agentThoughtHeader', params: { mode: ctx.agentMode.toUpperCase(), step: ctx.stepCount } }, streamedOutput, {
    category: 'agent_thought',
    modelName: effectiveUsedModel,
  })
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logLlmResponse(ctx.sessionId, ctx.stepCount, streamedOutput)
  }

  return {
    outcome: 'proceed',
    data: {
      streamedOutput,
      nativeCalls: dispatchResult.nativeTurn.toolCalls,
      hasRecentToolFailure: prepared.hasRecentToolFailure,
      errorCountInHistory: prepared.errorCountInHistory,
      compiledHistoryBlock: prepared.compiledHistoryBlock,
      targetModel: effectiveUsedModel,
    },
  }
}
