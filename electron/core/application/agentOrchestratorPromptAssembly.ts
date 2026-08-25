import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import os from 'node:os'
import { findMatchingInstalledModel } from '../domain/agent/modelTagMatcher'
import { HardwareProfileResolver, type OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import { assembleTurnPrompt as assembleDomainTurnPrompt } from '../domain/agent/agentPromptAssembler'
import { HeuristicContextCompactor } from '../domain/agent/heuristicContextCompactor'
import { calculateDynamicContextWindow } from '../domain/agent/contextWindowCalculator'
import { supportsNativeToolCalling } from '../domain/agent/ollamaToolCallingCapability'
import { resolveOllamaContextReuse, type OllamaContextReuseDecision } from '../domain/agent/ollamaContextCacheManager'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { generateCompactRepoMap } from '../domain/agent/compactSemanticRepoMapper'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { skillAppService } from './skillAppService'
import { resolvePlanDirectiveForTurn } from './agentOrchestratorCircuitBreakerAndVerification'
import { resolveTurnContextPolicy, omittedBlockNames } from '../domain/agent/turnContextPolicy'
import type { TurnDispatchContext, ModelSelection } from './agentOrchestratorTurnDispatchTypes'

/** Resolves the coding model and hardware-tuned runtime options for the turn. */
export function selectModelForTurn(ctx: TurnDispatchContext): ModelSelection {
  const cachedGpu = getCachedGpuInfo()
  const memInfo = getMemoryInfo()

  const candidateCoding = ctx.settings.codingModel || ctx.settings.defaultModel || 'qwen2.5-coder:7b'
  const targetModel: string = ctx.currentOverriddenModel
    ? ctx.currentOverriddenModel
    : findMatchingInstalledModel(candidateCoding, ctx.availableModels) || candidateCoding

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
    }
  )

  // The hardware profile answers "how much context can this MACHINE hold". It cannot answer
  // "how much will Ollama actually use", and the two disagree constantly: Ollama clamps any
  // num_ctx above the model's trained context_length down to it, then truncates the HEAD of the
  // prompt to fit — which is the system prompt and the plan block, the two things the agent
  // cannot work without (measured 2026-08-24, see ollamaHttpClient.getModelMetrics).
  //
  // The damage was never the clamp itself; it was maxContextChars being derived from the
  // UNCLAMPED window. That told HeuristicContextCompactor there was room it did not have, so it
  // declined to compact and handed Ollama a prompt guaranteed to be beheaded. Deriving both
  // num_predict and maxContextChars from the clamped value turns a silent decapitation into
  // ordinary, visible compaction of the tail.
  const contextCeiling = ctx.modelMetrics?.[targetModel]?.contextLength ?? null
  if (contextCeiling !== null && contextCeiling < runtimeOpts.num_ctx) {
    ctx.emitLog(
      'info',
      `📏 Context clamped to model limit: ${runtimeOpts.num_ctx} → ${contextCeiling} tokens (${targetModel} was trained at ${contextCeiling}; Ollama would have truncated the prompt head).`
    )
    runtimeOpts.num_ctx = contextCeiling
    runtimeOpts.num_predict = HardwareProfileResolver.deriveNumPredict(contextCeiling)
    runtimeOpts.maxContextChars = HardwareProfileResolver.deriveMaxContextChars(contextCeiling)
  }

  // Resilience fallback only — the model swapped in when the primary OOMs or crashes.
  // It is NOT a routing tier: nothing selects it based on task difficulty.
  const candidateFallback = ctx.settings.codingFallbackModel || ctx.settings.defaultModel || 'qwen2.5-coder:7b'
  const fallbackModel = findMatchingInstalledModel(candidateFallback, ctx.availableModels) || candidateFallback

  return {
    targetModel,
    targetModelToolCallingCapable,
    fallbackModel,
    runtimeOpts,
    contextCeiling,
  }
}

export async function assembleTurnPrompt(ctx: TurnDispatchContext, selection: ModelSelection, compiledHistoryBlock: string) {
  // One decision, arbitrated in planDirectiveArbiter.ts, for the channel that reaches the
  // model on every single turn. The states it selects between are the ones in which the plan
  // block's standing directives assert something false — and the one in which they assert
  // nothing at all, leaving `write_file` as the only action the model is ever pointed at.
  const directive = resolvePlanDirectiveForTurn(
    ctx.workspacePath,
    ctx.goalPlanner,
    ctx.hasVerifiedBuild,
    ctx.episodicCompactor.getEpisodes()
  )
  const planBlock = ctx.goalPlanner.compileProgressPrompt({ directive })

  // The same decision, spent twice. `directive.kind` was computed on every turn and discarded;
  // it already answers which of the optional blocks below this turn can use. See
  // turnContextPolicy.ts — the plan block above and the tool history are never candidates.
  const policy = resolveTurnContextPolicy(directive.kind)
  const omitted = omittedBlockNames(policy)
  if (omitted.length > 0) {
    ctx.emitLog('info', `🎯 Context policy [${directive.kind}]: ${policy.rationale} — omitting ${omitted.join(', ')}.`)
  }

  const skillsBlock = !policy.includeSkills
    ? ''
    : ctx.skillsBlock !== undefined
      ? ctx.skillsBlock
      : await skillAppService.getContextSkillsBlock(ctx.skillMatchContext, ctx.workspacePath, 3, ctx.skillMatchingOptions)

  // The debt tracker rides the attached-context channel, so it follows the same flag. Nothing is
  // lost by withholding it: SESSION_TRACKER.md is on disk and is re-read on the next focus turn.
  let debtTrackerBlock = ''
  if (ctx.workspacePath && policy.includeAttachedRag) {
    try {
      const trackerContent = agentSessionStateRepository.loadSessionTrackerMarkdown(ctx.workspacePath)
      if (trackerContent) {
        debtTrackerBlock = SessionDebtTracker.parseTrackerMarkdown(trackerContent).compilePromptBlock()
      }
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestratorAppService', `Failed reading SESSION_TRACKER.md: ${err.message}`)
    }
  }
  const effectiveAttachedContext = policy.includeAttachedRag
    ? [debtTrackerBlock, ctx.attachedContext].filter(Boolean).join('\n\n')
    : ''

  // Skipped outright rather than assembled and discarded: generateCompactRepoMap walks the
  // workspace tree on every turn, so this is latency as well as context.
  let currentProjectMapStr = ''
  if (policy.includeProjectMap) {
    currentProjectMapStr = ctx.projectContextMapStr
    if (ctx.workspacePath && !ctx.isStandaloneMode) {
      try {
        currentProjectMapStr = generateCompactRepoMap(ctx.workspacePath, 150)
      } catch {
        currentProjectMapStr = ctx.projectContextMapStr
      }
    }
  }

  // Assemble base prompt segments, then apply heuristic compaction at 75% watermark.
  const assembled = assembleDomainTurnPrompt({
    userTask: ctx.userTask,
    initialUserTask: ctx.initialUserTask,
    agentMode: ctx.agentMode,
    stepCount: ctx.stepCount,
    maxSteps: ctx.maxSteps,
    workspacePath: ctx.workspacePath,
    isStandaloneMode: ctx.isStandaloneMode,
    activeFile: policy.includeActiveFile ? ctx.payload.activeFile : null,
    pinnedFilesContextStr: policy.includePinnedFiles ? ctx.pinnedFilesContextStr : '',
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

  // Feed the compactor the assembler's DISJOINT segments. Passing `assembled.stableSection`
  // as `systemPrompt` (as this once did) duplicated the plan, pinned/active files, skills, RAG
  // and repo-map bytes — they are already inside stableSection — so the compactor measured the
  // prompt at roughly double its real size. That tripped the 75% watermark on prompts that
  // actually fit, and made `remaining = budget - immutableSize` negative, which floored
  // historyAlloc at 0 and replaced the entire tool history with "...[compacted]". With no
  // history the prompt was byte-identical every turn, so the model deterministically re-emitted
  // its first tool call forever (see coding_agent_audit.log session-1787441347002-hu1s).
  const seg = assembled.segments
  const compactionResult = HeuristicContextCompactor.compile(
    {
      systemPrompt: seg.baseSystemPrompt || basePrompt,
      activePlanBlock: seg.planSection,
      pinnedFilesBlock: seg.pinnedBlock,
      activeFileBlock: seg.activeFileBlock,
      skillsBlock: seg.skillsSection,
      historyBlock: compiledHistoryBlock,
      attachedContext: seg.attachedBlock,
      projectMapBlock: seg.mapBlock,
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
 *
 * The freeze is per SESSION; `contextCeiling` is per MODEL, and the two part company the moment
 * the resilience fallback swaps a smaller model in mid-session. The box still holds the window
 * the first model earned, and the last line of this function used to write it straight back into
 * `runtimeOpts` — silently undoing the clamp selectModelForTurn had just applied and handing
 * Ollama a window it answers by truncating the prompt head. Hence the ceiling is applied to the
 * value that LEAVES this function, not only to the one that enters the box.
 */
export function freezeOrGrowContextWindow(
  ctx: TurnDispatchContext,
  turnPrompt: string,
  runtimeOpts: OllamaRuntimeOptions,
  contextCeiling: number | null = null
) {
  // Headroom is the profile's own generation reserve (num_predict), not a second independent
  // constant: the two used to be set apart and disagreed about how much of the window the
  // completion needed.
  const requiredNumCtx = calculateDynamicContextWindow(turnPrompt, runtimeOpts.num_ctx, runtimeOpts.num_predict)
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

  const frozen = ctx.sessionNumCtxBox.value
  if (contextCeiling !== null && frozen > contextCeiling) {
    ctx.emitLog(
      'info',
      `📏 Frozen window ${frozen} exceeds this model's ceiling: holding at ${contextCeiling} tokens and compacting the tool history instead of requesting a window Ollama would clamp.`
    )
    runtimeOpts.num_ctx = contextCeiling
    return
  }
  runtimeOpts.num_ctx = frozen
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
