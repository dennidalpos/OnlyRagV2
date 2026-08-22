import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import os from 'node:os'
import { findMatchingInstalledModel } from '../domain/agent/complexityEvaluator'
import { HardwareProfileResolver, type OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import { assembleTurnPrompt as assembleDomainTurnPrompt } from '../domain/agent/agentPromptAssembler'
import { HeuristicContextCompactor } from '../domain/agent/heuristicContextCompactor'
import { calculateDynamicContextWindow } from '../domain/agent/contextWindowCalculator'
import { supportsNativeToolCalling } from '../domain/agent/ollamaToolCallingCapability'
import { resolveOllamaContextReuse, type OllamaContextReuseDecision } from '../domain/agent/ollamaContextCacheManager'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { generateCompactRepoMap } from '../domain/agent/compactSemanticRepoMapper'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { skillAppService } from './skillAppService'
import type { TurnDispatchContext, ModelSelection } from './agentOrchestratorTurnDispatchTypes'

/** Resolves the coding model and hardware-tuned runtime options for the turn. */
export function selectModelForTurn(ctx: TurnDispatchContext, _hasRecentToolFailure: boolean, _errorCountInHistory: number): ModelSelection {
  const cachedGpu = getCachedGpuInfo()
  const memInfo = getMemoryInfo()

  const candidateCoding = ctx.settings.codingModel || ctx.settings.defaultModel || 'qwen2.5-coder:7b'
  const targetModel: string = ctx.currentOverriddenModel
    ? ctx.currentOverriddenModel
    : findMatchingInstalledModel(candidateCoding, ctx.availableModels) || candidateCoding

  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logComplexityRouting(
      ctx.sessionId,
      ctx.stepCount,
      { tier: 'standard', tierName: 'Standard', modelName: targetModel, isEscalated: false, reasoning: 'Direct execution on primary coding model' },
      targetModel
    )
  }

  // Native tool-calling routing: when the primary model is detected as tool-calling capable
  // (see ollamaToolCallingCapability.ts), route via POST /api/chat with the structured tool
  // catalog instead of relying solely on the prompt-engineered JSON convention.
  const targetModelToolCallingCapable = supportsNativeToolCalling(targetModel, ctx.modelCapabilities)
  if (targetModelToolCallingCapable) {
    ctx.session.ollamaContextModel = undefined
  }

  const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(
    ctx.settings.hardwareProfile,
    {
      hasGpu: cachedGpu?.hasNvidiaGpu,
      vramTotalMB: cachedGpu?.vramTotalMB,
      systemRamGB: memInfo.totalRAMGB,
      cpuCount: os.cpus()?.length,
      enableSystemRamOffloading: ctx.settings.enableSystemRamOffloading,
    },
    'standard'
  )

  const candidateFallback = ctx.settings.codingFallbackModel || ctx.settings.defaultModel || 'qwen2.5-coder:7b'
  const fallbackModel = findMatchingInstalledModel(candidateFallback, ctx.availableModels) || candidateFallback

  return {
    targetModel,
    targetModelToolCallingCapable,
    intermediateModel: targetModel,
    fallbackModel,
    heavyEscalationModel: undefined,
    runtimeOpts,
    complexityTier: 'standard',
  }
}

export async function assembleTurnPrompt(ctx: TurnDispatchContext, selection: ModelSelection, compiledHistoryBlock: string) {
  const skillsBlock = ctx.skillsBlock !== undefined
    ? ctx.skillsBlock
    : await skillAppService.getContextSkillsBlock(ctx.skillMatchContext, ctx.workspacePath, 3, ctx.skillMatchingOptions)
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

  let currentProjectMapStr = ctx.projectContextMapStr
  if (ctx.workspacePath && !ctx.isStandaloneMode) {
    try {
      currentProjectMapStr = generateCompactRepoMap(ctx.workspacePath, 150)
    } catch {
      currentProjectMapStr = ctx.projectContextMapStr
    }
  }

  // Assemble base prompt segments, then apply heuristic compaction at 75% watermark.
  const assembled = assembleDomainTurnPrompt({
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
    projectContextMapStr: currentProjectMapStr,
    settings: ctx.settings,
    runtimeOpts: selection.runtimeOpts,
    toolCallingCapable: selection.targetModelToolCallingCapable,
  })
  const basePrompt = assembled.prompt

  const compactionResult = HeuristicContextCompactor.compile(
    {
      systemPrompt: assembled.stableSection || basePrompt,
      activePlanBlock: planBlock,
      pinnedFilesBlock: ctx.pinnedFilesContextStr,
      activeFileBlock: ctx.payload.activeFile
        ? `Active File: ${ctx.payload.activeFile.name}\n${(ctx.payload.activeFile.content || '').slice(0, 8000)}`
        : '',
      skillsBlock,
      historyBlock: compiledHistoryBlock,
      attachedContext: ctx.attachedContext,
      projectMapBlock: currentProjectMapStr,
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
  const requiredNumCtx = calculateDynamicContextWindow(turnPrompt, runtimeOpts.num_ctx)
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
