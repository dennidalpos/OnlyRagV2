import { logger } from '../infrastructure/logging/logger'
import { hardwareProbe } from '../infrastructure/diagnostics/hardwareProbe'
import os from 'node:os'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import path from 'node:path'
import { findMatchingInstalledModel } from '../../../shared/domain/agent/modelTagMatcher'
import { HardwareProfileResolver, type OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import { assembleTurnPrompt as assembleDomainTurnPrompt } from '../domain/agent/agentPromptAssembler'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { generateCompactRepoMap } from '../infrastructure/filesystem/compactSemanticRepoMapper'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { skillAppService } from './skillAppService'
import { resolvePlanDirectiveForTurn } from './agentOrchestratorCircuitBreakerAndVerification'
import { resolveTurnContextPolicy, omittedBlockNames } from '../domain/agent/turnContextPolicy'
import { extractDeliverablePaths } from '../../../shared/domain/agent/milestoneDeliverableResolver'
import { buildExplicitFirstCommandDirective } from '../domain/agent/planDirectiveArbiter'
import type { PlanDirectiveDecision } from '../domain/agent/planDirectiveArbiter'
import type { TurnDispatchContext, ModelSelection } from './agentOrchestratorRunContext'
import { resolveModelContextLength } from '../../../shared/domain/settings/modelContextPreference'
import { resolveModelSamplingOverrides } from '../../../shared/domain/agent/ollamaSamplingOptions'
import { resolveTurnToolPolicy, resolveVersionConflictTurnPolicy, type EditTargetState, type TurnToolPolicy } from '../domain/agent/turnToolPolicy'
import { normalizeOllamaHost } from '../../../shared/domain/ollamaHost'
import { resolveConfiguredModel } from '../../../shared/domain/settings/configuredModel'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { recordFileVersion } from '../domain/agent/fileVersionEvidence'
import { contentVersion } from '../infrastructure/filesystem/fileContentVersion'
import { emitLocalizedLog } from './agentOrchestratorTypes'

/** Resolves the coding model and hardware-tuned runtime options for the turn. */
export function selectModelForTurn(ctx: TurnDispatchContext): ModelSelection {
  const cachedGpu = hardwareProbe.getCachedGpuInfo()
  const memInfo = hardwareProbe.getMemoryInfo()
  const hardwareFacts = ctx.hardwareFacts ?? {
    hasGpu: cachedGpu?.hasNvidiaGpu,
    vramTotalMB: cachedGpu?.vramTotalMB,
    systemRamGB: memInfo.totalRAMGB,
    cpuCount: os.cpus()?.length,
  }

  // The preflight already refused a run without a configured model.
  const candidateCoding = resolveConfiguredModel('coding', ctx.settings, ctx.codingModel)
  const targetModel = findMatchingInstalledModel(candidateCoding, ctx.availableModels) || candidateCoding

  // Only the context window is pinned per session. Sampling comes from the user's current per-model
  // overrides; with none, the Modelfile defaults apply (checkpoints written before 2026-09-26 carried
  // a fixed 0.1/0.9/1.1 profile that is deliberately dropped here).
  const pinnedRuntime = ctx.session.ollamaRuntimeProfile
  const baseOpts = pinnedRuntime ? pinnedRuntime.options : HardwareProfileResolver.resolveOllamaOptions('Auto', { ...hardwareFacts })
  const runtimeOpts: OllamaRuntimeOptions = {
    num_ctx: baseOpts.num_ctx,
    num_predict: baseOpts.num_predict,
    maxContextChars: baseOpts.maxContextChars,
    ...resolveModelSamplingOverrides(targetModel, ctx.settings.modelSamplingOverrides),
  }

  if (pinnedRuntime) {
    return {
      targetModel,
      runtimeOpts,
      contextCeiling: ctx.modelMetrics?.[targetModel]?.contextLength ?? null,
    }
  }

  // The hardware profile answers "how much context can this MACHINE hold". It cannot answer
  // "how much will Ollama actually use", and the two disagree constantly: Ollama clamps any
  // num_ctx above the model's trained context_length down to it, then truncates the HEAD of the
  // prompt to fit — which is the system prompt and the plan block, the two things the agent
  // cannot work without (measured 2026-08-24, see ollamaHttpClient.getModelMetrics).
  //
  // Every budget (num_predict, maxContextChars, the chat transcript's prompt budget) is therefore
  // derived from the clamped window, never from the hardware one.
  const hardwareContext = runtimeOpts.num_ctx
  const trainedContext = ctx.modelMetrics?.[targetModel]?.contextLength
  const preferredContext = resolveModelContextLength(targetModel, ctx.settings.modelContextLengths, hardwareContext, trainedContext)
  const contextCeiling = trainedContext ?? null
  if (contextCeiling !== null && contextCeiling < hardwareContext) {
    emitLocalizedLog(ctx.emitLog, 'info', { key: 'contextClamped', params: { hardware: hardwareContext, ceiling: contextCeiling, model: targetModel } })
  }
  if (preferredContext !== runtimeOpts.num_ctx) {
    emitLocalizedLog(ctx.emitLog, 'info', {
      key: 'contextPreference',
      params: { previous: runtimeOpts.num_ctx, preferred: preferredContext, model: targetModel },
    })
  }
  runtimeOpts.num_ctx = preferredContext
  runtimeOpts.num_predict = HardwareProfileResolver.deriveNumPredict(preferredContext)
  runtimeOpts.maxContextChars = HardwareProfileResolver.deriveMaxContextChars(preferredContext)

  ctx.session.ollamaRuntimeProfile = {
    model: targetModel,
    host: normalizeOllamaHost(ctx.settings.ollamaHost),
    digest: ctx.modelMetrics?.[targetModel]?.digest,
    options: { num_ctx: runtimeOpts.num_ctx, num_predict: runtimeOpts.num_predict, maxContextChars: runtimeOpts.maxContextChars },
  }

  return {
    targetModel,
    runtimeOpts,
    contextCeiling,
  }
}

const PRIMARY_FILE_CHAR_CAP = 12000
const SUPPORT_FILE_CHAR_CAP = 3000
const MAX_SUPPORT_FILES = 2

function boundedFileContent(content: string, cap: number): string {
  if (content.length <= cap) return content
  const half = Math.floor(cap / 2)
  const omitted = content.length - half * 2
  return `${content.slice(0, half)}\n[CONTENT OMITTED: ${omitted} chars; use read_file for the required range]\n${content.slice(-half)}`
}

/** Injects one primary file and at most two bounded support fragments. */
export function readTurnFileContext(ctx: TurnDispatchContext, targets: readonly string[] | undefined, reason: string): string {
  if (!targets?.length || !ctx.workspacePath) return ''

  const root = path.resolve(ctx.workspacePath)
  const blocks: string[] = []
  for (const [index, relativePath] of targets.slice(0, 1 + MAX_SUPPORT_FILES).entries()) {
    try {
      const absolute = path.resolve(root, relativePath)
      if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue
      const content = documentIoRepository.readText(absolute)
      if (!content.trim()) continue
      const role = index === 0 ? 'PRIMARY EDIT FILE' : 'SUPPORT FRAGMENT'
      const cap = index === 0 ? PRIMARY_FILE_CHAR_CAP : SUPPORT_FILE_CHAR_CAP
      // The prompt carries the whole file, so the model has seen this exact version and may edit it
      // without a read_file round trip; a truncated body is not the whole file.
      const evidence = ctx.state?.versionEvidence
      if (evidence && content.length <= cap) recordFileVersion(evidence, relativePath, contentVersion(content))
      blocks.push(`--- ${role}: ${relativePath} (${reason}) ---\n${boundedFileContent(content, cap)}`)
    } catch {
      // The model can request missing context through read_file.
    }
  }

  if (blocks.length === 0) return ''
  return `CURRENT ON-DISK CONTENT OF THE FILE(S) THIS TURN IS ABOUT — EDIT THIS, DO NOT REPLACE IT WITH A SHORTER FILE:\n${blocks.join('\n\n')}\n`
}

/** The files this turn is about: the ones the active directive orders rewritten, or — on an ordinary progress turn — the deliverables the active milestone names, which are the files the model is about to write. */
export function resolveTurnFileTargets(ctx: TurnDispatchContext, directive: PlanDirectiveDecision): { targets: readonly string[]; reason: string } {
  if (directive.rewriteTargets?.length) {
    return { targets: directive.rewriteTargets, reason: 'the file the directive above orders you to rewrite' }
  }
  if (directive.kind !== 'focus') return { targets: [], reason: '' }

  const active = ctx.goalPlanner.getActiveMilestone()
  return {
    targets: active?.filePaths?.length ? active.filePaths : extractDeliverablePaths(active?.title || ctx.userTask),
    reason: 'already on disk for the active milestone — edit it rather than overwrite it',
  }
}

function resolveEditTargetState(ctx: TurnDispatchContext, targets: readonly string[]): EditTargetState {
  if (!ctx.workspacePath || targets.length === 0) return 'unknown'
  const root = path.resolve(ctx.workspacePath)
  const target = path.resolve(root, targets[0])
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return 'unknown'
  return documentIoRepository.exists(target) ? 'existing' : 'missing'
}

/** Tools whose success changes the workspace or re-checks it: a failure before one of them is history. */
const STATE_CHANGING_TOOLS = new Set([
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
  'delete_file',
  'move_file',
  'copy_file',
  'create_directory',
  'download_file',
  'run_command',
  'run_tests',
])

/**
 * The latest failure the workspace has not moved past. Live full task run 18 of 2026-09-24: a
 * loop block from step 33 carried an old "MUST run npm run build" order, the build then passed at
 * step 36, and "Last useful error" kept showing that order next to the arbiter's "MUST run npm
 * test" until no_mutation stopped the run at step 40 after four more builds.
 */
export function latestUnresolvedFailure<T extends { tool: string; isFailure?: boolean }>(logs: readonly T[]): T | undefined {
  for (const entry of [...logs].reverse()) {
    if (entry.isFailure) return entry
    if (STATE_CHANGING_TOOLS.has(entry.tool)) return undefined
  }
  return undefined
}

/** Builds the fresh, bounded facts needed for only the current operation. */
export function buildCurrentOperationContext(
  ctx: TurnDispatchContext,
  directive: PlanDirectiveDecision,
  toolPolicy: TurnToolPolicy,
  targets: readonly string[],
): string {
  const milestone = ctx.goalPlanner.getActiveMilestone()
  const latestFailure = latestUnresolvedFailure(ctx.episodicCompactor.getRecentFullLogs())
  const constraints = [
    `mode=${ctx.fsmMode.getMode()}`,
    `workspace=${ctx.workspacePath || 'standalone'}`,
    `allowed tools=${toolPolicy.allowedTools.join(', ')}`,
    milestone?.notes ? `accepted decision=${milestone.notes}` : '',
  ].filter(Boolean)
  const relevant = targets.length > 0 ? targets.slice(0, 3).join(', ') : 'none selected yet'
  const failure = latestFailure
    ? `${latestFailure.tool}${latestFailure.target ? ` (${latestFailure.target})` : ''}: ${latestFailure.output.slice(0, 1200)}`
    : 'none'

  return [
    'CURRENT OPERATION CONTEXT:',
    `- Objective: ${milestone?.title || ctx.userTask}`,
    `- Directive: ${directive.kind}`,
    `- Accepted constraints: ${constraints.join('; ')}`,
    `- Relevant paths: ${relevant}`,
    `- Last useful error: ${failure}`,
  ].join('\n')
}

export async function assembleTurnPrompt(ctx: TurnDispatchContext, selection: ModelSelection) {
  // Use one arbiter decision for both the plan and tool policy.
  const directive = resolvePlanDirectiveForTurn(
    ctx.workspacePath,
    ctx.goalPlanner,
    ctx.flags.hasVerifiedBuild,
    ctx.episodicCompactor.getEpisodes(),
    (command) => ctx.episodicCompactor.lastFailureOutputFor('run_command', command),
    ctx.episodicCompactor.getRecentFullLogs(),
    ctx.settings.capabilityPolicyMode,
  )
  const progressPlanBlock = [buildExplicitFirstCommandDirective(ctx.userTask, ctx.stepCount === 1), ctx.goalPlanner.compileProgressPrompt({ directive })]
    .filter(Boolean)
    .join('\n\n')

  // Apply the directive to the optional context blocks.
  const policy = resolveTurnContextPolicy(directive.kind)
  const omitted = omittedBlockNames(policy)
  if (omitted.length > 0) {
    emitLocalizedLog(ctx.emitLog, 'info', { key: 'contextPolicy', params: { kind: directive.kind, reason: policy.rationale, omitted: omitted.join(', ') } })
  }

  // Rewrite directives expose the target file; version conflicts require a fresh read.
  const requiredReadPath = ctx.state.pendingVersionConflictReadPath
  const turnFiles = requiredReadPath
    ? { targets: [requiredReadPath], reason: 'the file whose previous edit used a stale version' }
    : resolveTurnFileTargets(ctx, directive)
  const toolPolicy = requiredReadPath
    ? resolveVersionConflictTurnPolicy(requiredReadPath)
    : resolveTurnToolPolicy({
        directiveKind: directive.kind,
        editTargetState: resolveEditTargetState(ctx, turnFiles.targets),
        userTask: ctx.userTask,
        requiredTools: directive.requiredTools,
        agentMode: ctx.agentMode,
        capabilityPolicyMode: ctx.settings.capabilityPolicyMode,
      })
  emitLocalizedLog(ctx.emitLog, 'info', {
    key: 'toolPolicy',
    params: { kind: directive.kind, reason: toolPolicy.rationale, tools: toolPolicy.allowedTools.join(', ') },
  })
  const planBlock = [
    buildCurrentOperationContext(ctx, directive, toolPolicy, turnFiles.targets),
    requiredReadPath ? `[FILE VERSION RECOVERY]\nCall read_file on "${requiredReadPath}" now. No edit is available until that read succeeds.` : '',
    progressPlanBlock,
  ]
    .filter(Boolean)
    .join('\n\n')
  const rewriteTargetBlock = policy.includePinnedFiles ? readTurnFileContext(ctx, turnFiles.targets, turnFiles.reason) : ''

  const skillsBlock = !policy.includeSkills
    ? ''
    : ctx.skillsBlock !== undefined
      ? ctx.skillsBlock
      : await skillAppService.getContextSkillsBlock(ctx.skillMatchContext, ctx.workspacePath, 3, ctx.skillMatchingOptions)

  // SESSION_TRACKER.md is persisted and re-read on the next focus turn.
  let debtTrackerBlock = ''
  if (ctx.workspacePath && policy.includeAttachedRag) {
    try {
      const trackerContent = agentSessionStateRepository.loadSessionTrackerMarkdown(ctx.workspacePath)
      if (trackerContent) {
        debtTrackerBlock = SessionDebtTracker.parseTrackerMarkdown(trackerContent).compilePromptBlock()
      }
    } catch (err: unknown) {
      logger.log('WARN', 'AgentOrchestratorAppService', `Failed reading SESSION_TRACKER.md: ${errorMessage(err)}`)
    }
  }
  const effectiveAttachedContext = policy.includeAttachedRag ? [debtTrackerBlock, ctx.attachedContext].filter(Boolean).join('\n\n') : ''

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

  // The segments become the frozen system message and this turn's context message (see agentOrchestratorTurnDispatch).
  const assembled = assembleDomainTurnPrompt({
    userTask: ctx.userTask,
    initialUserTask: ctx.initialUserTask,
    agentMode: ctx.agentMode,
    stepCount: ctx.stepCount,
    maxSteps: ctx.maxSteps,
    workspacePath: ctx.workspacePath,
    isStandaloneMode: ctx.isStandaloneMode,
    activeFile: policy.includeActiveFile ? ctx.payload.activeFile : null,
    pinnedFilesContextStr: policy.includePinnedFiles ? [ctx.pinnedFilesContextStr, rewriteTargetBlock].filter(Boolean).join('\n') : '',
    skillsBlock,
    planBlock,
    attachedContext: effectiveAttachedContext,
    projectContextMapStr: currentProjectMapStr,
    settings: ctx.settings,
    runtimeOpts: selection.runtimeOpts,
  })
  return { assembled, toolPolicy }
}

/** Keeps the selected per-model context stable; prompt size is handled by transcript trimming, not ctx resizing. */
export function freezeContextWindow(ctx: TurnDispatchContext, runtimeOpts: OllamaRuntimeOptions) {
  if (ctx.sessionNumCtxBox.value === null) {
    ctx.sessionNumCtxBox.value = runtimeOpts.num_ctx
  } else {
    runtimeOpts.num_ctx = ctx.sessionNumCtxBox.value
    runtimeOpts.num_predict = HardwareProfileResolver.deriveNumPredict(runtimeOpts.num_ctx)
    runtimeOpts.maxContextChars = HardwareProfileResolver.deriveMaxContextChars(runtimeOpts.num_ctx)
  }
}
