import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import os from 'node:os'
import { evaluateTaskComplexity } from '../domain/agent/complexityEvaluator'
import { HardwareProfileResolver, type OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import { AgentPromptAssembler } from '../domain/agent/agentPromptAssembler'
import { HeuristicContextCompactor } from '../domain/agent/heuristicContextCompactor'
import { calculateDynamicContextWindow } from '../domain/agent/contextWindowCalculator'
import { supportsNativeToolCalling } from '../domain/agent/ollamaToolCallingCapability'
import { resolveOllamaContextReuse, type OllamaContextReuseDecision } from '../domain/agent/ollamaContextCacheManager'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { skillAppService } from './skillAppService'
import type { TurnDispatchContext, ModelSelection } from './agentOrchestratorTurnDispatchTypes'

/** Complexity-routes the turn to a model, then resolves the tier's hardware-tuned runtime options. */
export function selectModelForTurn(ctx: TurnDispatchContext, hasRecentToolFailure: boolean, errorCountInHistory: number): ModelSelection {
  const routedComplexity = evaluateTaskComplexity(ctx.userTask, {
    attachedFilesCount: ctx.payload.pinnedFiles?.length || 0,
    contextSizeChars: ctx.payload.activeFile?.content?.length || 0,
    settings: ctx.settings,
    availableModels: ctx.availableModels,
    hasRecentToolFailure,
    errorCountInHistory,
  })
  if (routedComplexity.isEscalated && ctx.stepCount > 1) {
    ctx.emitLog('info', `⚡ Complexity Escalated: ${routedComplexity.modelName}`, routedComplexity.reasoning)
  }

  const targetModel: string = ctx.currentOverriddenModel
    ? ctx.currentOverriddenModel
    : ctx.settings.useComplexityRouting
    ? routedComplexity.modelName
    : ctx.settings.codingModel || ctx.settings.defaultModel || 'llama3.2'

  // Native tool-calling routing: when the primary model is detected as tool-calling capable
  // (see ollamaToolCallingCapability.ts), route via POST /api/chat with the structured tool
  // catalog instead of relying solely on the prompt-engineered JSON convention. toolParser.ts
  // still parses the result either way (see agentStreamTransport.ts's serializeNativeToolCall),
  // so downstream tool execution is unaffected by which path produced the output.
  const targetModelToolCallingCapable = supportsNativeToolCalling(targetModel, ctx.modelCapabilities)
  if (targetModelToolCallingCapable) {
    // The native tool-calling /api/chat path doesn't populate `context` (see
    // agentStreamTransport.ts), so any cached baseline from an earlier /api/generate turn
    // would be stale. Clear it so a later turn that returns to the /api/generate path always
    // starts from a full resend.
    ctx.session.ollamaContextModel = undefined
  }

  const cachedGpu = getCachedGpuInfo()
  const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(
    ctx.settings.hardwareProfile,
    {
      hasGpu: cachedGpu?.hasNvidiaGpu,
      vramTotalMB: cachedGpu?.vramTotalMB,
      systemRamGB: getMemoryInfo().totalRAMGB,
      cpuCount: os.cpus()?.length,
    },
    routedComplexity.tier
  )

  return {
    targetModel,
    targetModelToolCallingCapable,
    intermediateModel: ctx.settings.complexityStandardModel || ctx.settings.codingModel || ctx.settings.defaultModel || 'llama3.2',
    fallbackModel: ctx.settings.complexityFastModel || ctx.settings.defaultModel || 'llama3.2',
    heavyEscalationModel: ctx.settings.complexityHeavyModel || undefined,
    runtimeOpts,
    complexityTier: routedComplexity.tier,
  }
}

export async function assembleTurnPrompt(ctx: TurnDispatchContext, selection: ModelSelection, compiledHistoryBlock: string) {
  const skillsBlock = await skillAppService.getContextSkillsBlock(ctx.skillMatchContext, ctx.workspacePath, 3, ctx.skillMatchingOptions)
  const planBlock = ctx.goalPlanner.compileProgressPrompt()

  let debtTrackerBlock = ''
  if (ctx.workspacePath) {
    try {
      const trackerContent = agentSessionStateRepository.loadSessionTrackerMarkdown(ctx.workspacePath)
      if (trackerContent) {
        debtTrackerBlock = SessionDebtTracker.parseTrackerMarkdown(trackerContent).compilePromptBlock()
      }
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestratorAppService', `Failed reading SESSION_TRACKER.md: ${err.message}`)
    }
  }
  const effectiveAttachedContext = [debtTrackerBlock, ctx.attachedContext].filter(Boolean).join('\n\n')

  // Assemble base prompt segments, then apply heuristic compaction at 75% watermark.
  const assembled = AgentPromptAssembler.assembleTurnPrompt({
    userTask: ctx.userTask,
    initialUserTask: ctx.initialUserTask,
    agentMode: ctx.agentMode,
    stepCount: ctx.stepCount,
    maxSteps: ctx.maxSteps,
    complexityTier: selection.complexityTier,
    workspacePath: ctx.workspacePath,
    isStandaloneMode: ctx.isStandaloneMode,
    activeFile: ctx.payload.activeFile,
    pinnedFilesContextStr: ctx.pinnedFilesContextStr,
    skillsBlock,
    planBlock,
    toolOutputHistory: compiledHistoryBlock,
    attachedContext: effectiveAttachedContext,
    projectContextMapStr: ctx.projectContextMapStr,
    settings: ctx.settings,
    runtimeOpts: selection.runtimeOpts,
    toolCallingCapable: selection.targetModelToolCallingCapable,
  })
  const basePrompt = assembled.prompt

  const compactionResult = HeuristicContextCompactor.compile(
    {
      systemPrompt: basePrompt.split('\n\n')[0] || basePrompt,
      activePlanBlock: planBlock,
      pinnedFilesBlock: ctx.pinnedFilesContextStr,
      activeFileBlock: ctx.payload.activeFile
        ? `Active File: ${ctx.payload.activeFile.name}\n${(ctx.payload.activeFile.content || '').slice(0, 8000)}`
        : '',
      skillsBlock,
      historyBlock: compiledHistoryBlock,
      attachedContext: ctx.attachedContext,
      projectMapBlock: ctx.projectContextMapStr,
    },
    selection.runtimeOpts.maxContextChars
  )
  const turnPrompt = compactionResult.wasCompacted ? compactionResult.prompt : basePrompt
  if (compactionResult.wasCompacted) {
    ctx.emitLog('info', `🗜️ Context Compacted: ${compactionResult.originalChars} → ${compactionResult.finalChars} chars (heuristic, zero-cost)`)
  }

  return { assembled, compactionResult, turnPrompt }
}

/**
 * num_ctx is frozen for the lifetime of the session and only ever allowed to GROW. Ollama
 * reallocates its KV cache whenever num_ctx changes, which evicts the prompt cache —
 * recomputing it per step silently defeats the `context` continuation reuse below (AGT1), and
 * on CPU-only machines costs a model reload almost every turn. Growth is still permitted so a
 * prompt that outgrows the frozen window is never silently truncated; the cached baseline is
 * dropped in that case because the tokens it holds no longer correspond to the new window.
 */
export function freezeOrGrowContextWindow(ctx: TurnDispatchContext, turnPrompt: string, runtimeOpts: OllamaRuntimeOptions) {
  const requiredNumCtx = calculateDynamicContextWindow(turnPrompt.length, runtimeOpts.num_ctx)
  if (ctx.sessionNumCtxBox.value === null) {
    ctx.sessionNumCtxBox.value = requiredNumCtx
  } else if (requiredNumCtx > ctx.sessionNumCtxBox.value) {
    ctx.emitLog('info', `📐 Context window grown: ${ctx.sessionNumCtxBox.value} → ${requiredNumCtx} tokens (prompt outgrew the frozen window).`)
    ctx.sessionNumCtxBox.value = requiredNumCtx
    ctx.session.ollamaContextModel = undefined
    ctx.session.ollamaContextTokens = undefined
    ctx.session.ollamaContextStableSection = undefined
    ctx.session.ollamaContextHistoryBlock = undefined
  }
  runtimeOpts.num_ctx = ctx.sessionNumCtxBox.value
}

/**
 * AGT1: reuse Ollama's `context` continuation instead of resending the full prompt whenever
 * this turn's stable section + history are a byte-exact continuation of the prior turn's on
 * the SAME model (see ollamaContextCacheManager.ts). Native tool-calling turns never qualify
 * (the /api/chat path doesn't populate `context`).
 */
export function decideContextReuse(
  ctx: TurnDispatchContext,
  selection: ModelSelection,
  assembled: { stableSection: string; historyBlock: string; turnSuffix: string },
  turnPrompt: string,
  wasCompacted: boolean
): OllamaContextReuseDecision {
  if (selection.targetModelToolCallingCapable) {
    return { reusedContext: false, promptToSend: turnPrompt }
  }
  const decision = resolveOllamaContextReuse({
    targetModel: selection.targetModel,
    stableSection: assembled.stableSection,
    historyBlock: assembled.historyBlock,
    turnSuffix: assembled.turnSuffix,
    fullPrompt: turnPrompt,
    wasCompacted,
    baseline:
      ctx.session.ollamaContextModel === selection.targetModel && ctx.session.ollamaContextStableSection !== undefined
        ? {
            model: ctx.session.ollamaContextModel,
            stableSection: ctx.session.ollamaContextStableSection,
            historyBlock: ctx.session.ollamaContextHistoryBlock || '',
            contextTokens: ctx.session.ollamaContextTokens || [],
          }
        : null,
  })
  if (decision.reusedContext) {
    ctx.emitLog(
      'info',
      `⚡ Ollama Context Reuse: sending ${decision.promptToSend.length} chars instead of the full ${turnPrompt.length}-char prompt (KV-cache continuation).`
    )
  }
  return decision
}
