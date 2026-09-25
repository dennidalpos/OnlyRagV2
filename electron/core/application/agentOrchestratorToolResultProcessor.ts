import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { recordGuardEvent } from '../domain/agent/agentGuardEvents'
import path from 'node:path'
import type { AgentToolCall, AgentLogEntry } from '../domain/agent/agentTypes'
import type { ClassifiedToolExecutionResult } from './agentToolExecutorService'
import { DiagnosticOutputReducer, extractErrorDiagnostics, formatDiagnosticPrompt } from '../domain/agent/diagnosticOutputReducer'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { runCircuitBreaker, recordMutationSideEffects, recordCommandTouchedFiles, trackVerification } from './agentOrchestratorCircuitBreakerAndVerification'
import type { ResponseInterpreterState, ToolResultProcessingContext, ToolResultProcessingOutcome } from './agentOrchestratorRunContext'
import { emitLocalizedLog } from './agentOrchestratorTypes'
import { MAX_FAILURES_PER_RECOVERY_CATEGORY, recoveryStopDiagnostic } from '../domain/agent/recoveryBudget'
import { contentVersion } from '../infrastructure/filesystem/fileContentVersion'
import { redactSecrets } from '../../logRedactor'
import { findModuleExtensionAliases, resolveDeclaredFilePaths } from '../../../shared/domain/agent/milestoneDeliverableResolver'
import { fileVersionEvidenceKey, forgetFileVersion, knownFileVersion, recordFileVersion } from '../domain/agent/fileVersionEvidence'
import { type AgentLocalizedText, formatAgentTextIt } from '../../../shared/domain/agent/agentMainText'

export function isToolExecutionFailure(toolRes: ClassifiedToolExecutionResult): boolean {
  return toolRes.outcome !== 'success'
}

/**
 * Refusals that never reached the disk and carry their own recovery do not spend the one
 * execution correction: a version conflict is recovered by the mandatory read, and a syntax
 * rejection is the model's content failing validation, bounded by the same-file edit loop and
 * no_mutation guards. Counting the latter stopped runs whose correction for a failed build was
 * merely malformed (live full task and TS2614 runs of 2026-09-23: build 1/2, rejected write 2/2).
 */
export function shouldSpendExecutionRecoveryBudget(toolRes: ClassifiedToolExecutionResult): boolean {
  return (
    isToolExecutionFailure(toolRes) &&
    !toolRes.outputForHistory.includes('[FILE VERSION CONFLICT:') &&
    !toolRes.outputForHistory.startsWith('[PRE-COMMIT AST VALIDATION ERROR')
  )
}

export function terminalOutcomeFor(toolRes: ClassifiedToolExecutionResult): Extract<ToolResultProcessingOutcome, { outcome: 'return' }> | null {
  if (toolRes.terminalCode !== 'MODEL_UNSUITABLE') return null
  return { outcome: 'return', result: { success: false, summary: toolRes.outputForHistory, completionStatus: 'blocked' } }
}

type VersionRecoveryUpdate = { changed: boolean; conflictPath?: string }

function sameFilePath(left: string, right: string): boolean {
  return fileVersionEvidenceKey(left) === fileVersionEvidenceKey(right)
}

const VERSIONED_EDIT_TOOLS = new Set(['write_file', 'replace_file_content', 'multi_replace_file_content'])

/** The version an edit the agent just made left on disk: the agent authored that content. */
function versionAfterOwnEdit(workspacePath: string | null | undefined, filePath: string): string | undefined {
  if (!workspacePath) return undefined
  try {
    const root = path.resolve(workspacePath)
    const absolute = path.resolve(root, filePath)
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return undefined
    return contentVersion(documentIoRepository.readText(absolute))
  } catch {
    return undefined
  }
}

export function updateVersionConflictRecovery(
  ctx: Pick<ToolResultProcessingContext, 'toolRes' | 'parsedTool' | 'state'> & { workspacePath?: string | null },
): VersionRecoveryUpdate {
  ctx.state.versionEvidence ??= {}
  const evidence = ctx.state.versionEvidence
  const conflict = ctx.toolRes.outputForHistory.match(/\[FILE VERSION CONFLICT:\s*([^\]\r\n]+)\]/)
  if (ctx.toolRes.outcome !== 'success' && conflict) {
    const conflictPath = conflict[1].trim()
    forgetFileVersion(evidence, conflictPath)
    const missingNewFile = ctx.parsedTool.tool === 'write_file' && /\nCurrent:\s*missing(?:\r?\n|$)/i.test(ctx.toolRes.outputForHistory)
    if (missingNewFile) {
      ctx.state.pendingVersionConflictReadPath = undefined
      return { changed: true }
    }
    ctx.state.pendingVersionConflictReadPath = conflictPath
    return { changed: true, conflictPath }
  }
  if (ctx.toolRes.outcome !== 'success') return { changed: false }

  const filePath = String(ctx.parsedTool.parameters.filePath || '')
  if (!filePath) return { changed: false }
  if (ctx.parsedTool.tool === 'read_file') {
    const version = ctx.toolRes.outputForHistory.match(/\[FILE VERSION:\s*(sha256:[a-f0-9]+)\]/i)?.[1]
    if (!version) return { changed: false }
    recordFileVersion(evidence, filePath, version)
    if (ctx.state.pendingVersionConflictReadPath && sameFilePath(filePath, ctx.state.pendingVersionConflictReadPath)) {
      ctx.state.pendingVersionConflictReadPath = undefined
      ctx.state.progress.clearExecutionFailures()
    }
    return { changed: true }
  }
  if (VERSIONED_EDIT_TOOLS.has(ctx.parsedTool.tool)) {
    const version = versionAfterOwnEdit(ctx.workspacePath, filePath)
    if (!version) return { changed: false }
    recordFileVersion(evidence, filePath, version)
    return { changed: true }
  }
  return { changed: false }
}

/** Attaches the version the agent last saw of the edited file, unless the call carries its own. */
export function applyVersionedReadEvidence(
  toolCall: AgentToolCall,
  state: Pick<ResponseInterpreterState, 'versionEvidence'>,
): { toolCall: AgentToolCall; consumed: boolean } {
  if (!VERSIONED_EDIT_TOOLS.has(toolCall.tool) || toolCall.parameters.expectedContentHash) return { toolCall, consumed: false }
  const known = knownFileVersion(state.versionEvidence, String(toolCall.parameters.filePath || ''))
  if (!known) return { toolCall, consumed: false }
  return {
    consumed: true,
    toolCall: {
      ...toolCall,
      parameters: { ...toolCall.parameters, expectedContentHash: known },
    },
  }
}

function extractTargetParam(parsedTool: AgentToolCall): string | undefined {
  return (
    parsedTool.parameters?.filePath ||
    parsedTool.parameters?.file_path ||
    parsedTool.parameters?.path ||
    parsedTool.parameters?.command ||
    parsedTool.parameters?.url
  )
}

export function describeNonRollbackEffect(
  parsedTool: AgentToolCall,
  toolRes: ClassifiedToolExecutionResult,
  targetParam = extractTargetParam(parsedTool),
): string | undefined {
  if (toolRes.effectOutcome === 'uncertain') {
    return redactSecrets(`${parsedTool.tool}: effetto esterno incerto dopo ${targetParam || 'esecuzione senza target'}`)
  }
  if (toolRes.outcome === 'success' && ['run_command', 'ensure_tool', 'git_commit'].includes(parsedTool.tool)) {
    return redactSecrets(`${parsedTool.tool}: ${targetParam || 'effetto esterno confermato'}`)
  }
  return undefined
}

function distillOutput(toolRes: ClassifiedToolExecutionResult, isToolFailure: boolean): string {
  let distilled = toolRes.isTerminal ? DiagnosticOutputReducer.distillTerminalOutput(toolRes.outputForHistory, 2500) : toolRes.outputForHistory
  if (isToolFailure && toolRes.isTerminal) {
    const frame = extractErrorDiagnostics(toolRes.outputForHistory)
    if (frame) {
      distilled = `${distilled}\n\n${formatDiagnosticPrompt(frame)}`
    }
  }
  return distilled
}

function emitChangeMetrics(ctx: ToolResultProcessingContext) {
  if (!ctx.toolRes.changeStats) return
  ctx.recordChangedFile?.(ctx.toolRes.changeStats.filePath)
  const previous = ctx.sessionChangedFiles.get(ctx.toolRes.changeStats.filePath) || { additions: 0, deletions: 0 }
  ctx.sessionChangedFiles.set(ctx.toolRes.changeStats.filePath, {
    additions: previous.additions + ctx.toolRes.changeStats.additions,
    deletions: previous.deletions + ctx.toolRes.changeStats.deletions,
  })

  let totalAdditions = 0
  let totalDeletions = 0
  for (const entry of ctx.sessionChangedFiles.values()) {
    totalAdditions += entry.additions
    totalDeletions += entry.deletions
  }
  if (ctx.isSessionActive() && ctx.rendererEvents?.isAvailable()) {
    ctx.rendererEvents.send('agent:change-metrics', {
      ...ctx.runIdentity,
      filesTouched: ctx.sessionChangedFiles.size,
      additions: totalAdditions,
      deletions: totalDeletions,
    })
  }
}

function emitWorkspaceFileVersions(ctx: ToolResultProcessingContext, filePaths: Array<string | undefined>): void {
  if (!ctx.isSessionActive() || !ctx.rendererEvents?.isAvailable()) return

  for (const filePath of new Set(filePaths.filter((value): value is string => Boolean(value)))) {
    try {
      const exists = documentIoRepository.exists(filePath)
      if (exists && !documentIoRepository.isFile(filePath)) continue
      const contentHash = exists ? contentVersion(documentIoRepository.readText(filePath)) : undefined
      ctx.rendererEvents.send('workspace:file-version', {
        ...ctx.runIdentity,
        filePath,
        contentHash,
        deleted: !exists,
      })
    } catch {
      // An explicit reload retries discovery.
    }
  }
}

function resolvedMutationPaths(ctx: ToolResultProcessingContext, isToolFailure: boolean): string[] {
  if (isToolFailure || !ctx.workspacePath) return []
  const resolve = (value: unknown) => (typeof value === 'string' ? (path.isAbsolute(value) ? value : path.resolve(ctx.workspacePath!, value)) : undefined)
  const parameters = ctx.parsedTool.parameters
  if (ctx.parsedTool.tool === 'copy_file') return [resolve(parameters.targetPath || parameters.destination)].filter((value): value is string => Boolean(value))
  if (ctx.parsedTool.tool === 'move_file') {
    return [resolve(parameters.sourcePath || parameters.filePath), resolve(parameters.targetPath || parameters.destination)].filter((value): value is string =>
      Boolean(value),
    )
  }
  return []
}

/** Keeps milestone deliverables on the file a successful move_file produced (a rename ordered by a
 *  compiler directive must not leave milestones naming a path that no longer exists). */
function remapPlanAfterMove(ctx: ToolResultProcessingContext, isToolFailure: boolean): string[] {
  if (isToolFailure || ctx.parsedTool.tool !== 'move_file' || !ctx.workspacePath) return []
  const parameters = ctx.parsedTool.parameters
  const toWorkspaceRelative = (value: unknown) => {
    if (typeof value !== 'string' || !value) return undefined
    const relative = path.relative(ctx.workspacePath!, path.resolve(ctx.workspacePath!, value))
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : undefined
  }
  const source = toWorkspaceRelative(parameters.sourcePath || parameters.filePath)
  const target = toWorkspaceRelative(parameters.targetPath || parameters.destination)
  if (!source || !target) return []
  return ctx.goalPlanner.remapFilePath(source, target)
}

/** Points milestones that named `src/App.js` at the `src/App.jsx` the agent actually wrote, when the
 *  named file does not exist (see findModuleExtensionAliases). Runs before the mutation is matched
 *  against milestone deliverables, so this very write counts as their evidence. */
function remapPlanAfterAliasWrite(ctx: ToolResultProcessingContext, isToolFailure: boolean): Array<{ from: string; to: string; milestones: string[] }> {
  if (isToolFailure || !VERSIONED_EDIT_TOOLS.has(ctx.parsedTool.tool) || !ctx.workspacePath) return []
  const root = path.resolve(ctx.workspacePath)
  const absolute = path.resolve(root, String(ctx.parsedTool.parameters.filePath || ''))
  const written = path.relative(root, absolute).replace(/\\/g, '/')
  if (!written || written.startsWith('..') || path.isAbsolute(written)) return []

  const declared = [...new Set(ctx.goalPlanner.getMilestones().flatMap((milestone) => resolveDeclaredFilePaths(milestone)))]
  const remaps: Array<{ from: string; to: string; milestones: string[] }> = []
  for (const alias of findModuleExtensionAliases(declared, written)) {
    if (documentIoRepository.exists(path.resolve(root, alias))) continue
    const milestones = ctx.goalPlanner.remapFilePath(alias, written)
    if (milestones.length > 0) remaps.push({ from: alias, to: written, milestones })
  }
  return remaps
}

/** Post-processes a tool execution result: change-metrics IPC, stagnation circuit breaker (which may end the session), episodic recording, mutation/verification bookkeeping (see agentOrchestratorCircuitBreakerAndVerification.ts), and the final tool-result log lin */
export async function runToolResultProcessing(ctx: ToolResultProcessingContext): Promise<ToolResultProcessingOutcome> {
  const { toolRes, parsedTool } = ctx
  const isToolFailure = isToolExecutionFailure(toolRes)
  const versionRecovery = updateVersionConflictRecovery(ctx)

  const targetParam = extractTargetParam(parsedTool)
  const distilledOutput = distillOutput(toolRes, isToolFailure)
  const nonRollbackEffect = describeNonRollbackEffect(parsedTool, toolRes, targetParam)
  if (nonRollbackEffect) ctx.recordNonRollbackEffect?.(nonRollbackEffect)
  const isMutating =
    ['write_file', 'replace_file_content', 'multi_replace_file_content', 'delete_file', 'download_file'].includes(parsedTool.tool) && !toolRes.noOpMutation

  // Closes the loop detector's feedback path: it records INTENT before the tool runs, and only this line tells it what actually happened.
  ctx.loopDetector.recordOutcome(parsedTool, !isToolFailure)
  if (versionRecovery.conflictPath) ctx.loopDetector.resetTarget(versionRecovery.conflictPath)

  emitChangeMetrics(ctx)

  if (isToolFailure && shouldSpendExecutionRecoveryBudget(toolRes)) {
    const signature = `${parsedTool.tool}:${targetParam || ''}:${toolRes.logMessage.toLowerCase()}`
    const decision = ctx.state.progress.onExecutionFailure(signature)
    if (toolRes.effectOutcome === 'uncertain' || decision.action === 'stop') {
      const reason: AgentLocalizedText =
        toolRes.effectOutcome === 'uncertain'
          ? { key: 'reasonUncertainEffect', params: { tool: parsedTool.tool } }
          : { key: 'reasonExecutionRecovery', params: { diagnostic: recoveryStopDiagnostic('execution', decision.state) } }
      ctx.episodicCompactor.recordStep(
        {
          step: ctx.stepCount,
          tool: parsedTool.tool,
          target: targetParam,
          status: 'FAILURE',
          summary: toolRes.logMessage,
        },
        distilledOutput,
      )
      ctx.emitLog('terminal', formatAgentTextIt(reason), toolRes.logDetail, {
        localized: { message: reason },
        category: parsedTool.tool === 'run_command' ? 'command_execution' : 'tool_execution',
        toolName: parsedTool.tool,
        target: targetParam,
        status: 'failure',
      })
      const closure = await ctx.closeApplicationRun({
        trigger: 'guard_stop',
        guard: 'execution_budget',
        reason,
        modelSummary: toolRes.outputForHistory,
      })
      return closure.outcome === 'closed' ? { outcome: 'return', result: closure.result } : { outcome: 'continue' }
    }
    recordGuardEvent(ctx.state.guardEvents, 'execution_budget', 'advise', ctx.stepCount)
    emitLocalizedLog(
      ctx.emitLog,
      'info',
      { key: 'executionRecoveryAttempt', params: { used: decision.state.totalFailures, limit: MAX_FAILURES_PER_RECOVERY_CATEGORY } },
      toolRes.logDetail,
      { category: 'system_alert', toolName: parsedTool.tool, target: targetParam },
    )
  } else if (!isToolFailure && (isMutating || ['run_command', 'run_tests', 'ensure_tool', 'move_file', 'copy_file'].includes(parsedTool.tool))) {
    ctx.state.progress.clearExecutionFailures()
  }

  const breakerOutcome = await runCircuitBreaker(ctx, isMutating)
  if (breakerOutcome) return breakerOutcome

  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: parsedTool.tool,
      target: targetParam,
      status: isToolFailure ? 'FAILURE' : 'SUCCESS',
      summary: toolRes.logMessage,
    },
    distilledOutput,
  )
  if (versionRecovery.changed) await ctx.persistCurrentState()

  for (const remap of remapPlanAfterAliasWrite(ctx, isToolFailure)) {
    emitLocalizedLog(
      ctx.emitLog,
      'info',
      { key: 'planRemappedAlias', params: { milestones: remap.milestones.join(', '), from: remap.from, to: remap.to } },
      undefined,
      { category: 'system_alert', toolName: parsedTool.tool, target: targetParam },
    )
  }

  if (isMutating && !isToolFailure) {
    await recordMutationSideEffects(ctx, targetParam)
  }
  // Runs on failure too: a generator that aborts halfway still leaves directories behind,
  // and that leftover is precisely what the agent needs to be told about.
  const commandTouchedPaths = recordCommandTouchedFiles(ctx, isToolFailure)
  for (const filePath of [...commandTouchedPaths, ...resolvedMutationPaths(ctx, isToolFailure)]) {
    ctx.recordChangedFile?.(filePath)
  }
  emitWorkspaceFileVersions(ctx, [toolRes.changeStats?.filePath, ...commandTouchedPaths, ...resolvedMutationPaths(ctx, isToolFailure)])
  trackVerification(ctx, isToolFailure)

  const remappedMilestones = remapPlanAfterMove(ctx, isToolFailure)
  if (remappedMilestones.length > 0) {
    emitLocalizedLog(
      ctx.emitLog,
      'info',
      {
        key: 'planRemappedMove',
        params: { milestones: remappedMilestones.join(', '), target: String(parsedTool.parameters.targetPath || parsedTool.parameters.destination) },
      },
      undefined,
      { category: 'system_alert', toolName: parsedTool.tool, target: targetParam },
    )
    await ctx.persistCurrentState()
  }

  const toolName = parsedTool.tool
  let category: AgentLogEntry['category'] = 'tool_execution'
  let verb: AgentLogEntry['verb'] = undefined

  if (toolRes.noOpMutation) {
    // Nothing was created or edited, so the panel must not claim it was: the agent log is the
    // user's account of what the run did to their workspace. `logMessage` already says so.
    category = 'tool_execution'
  } else if (
    ['write_file', 'replace_file_content', 'multi_replace_file_content', 'delete_file', 'copy_file', 'move_file', 'create_directory'].includes(toolName)
  ) {
    category = 'file_mutation'
    verb =
      toolName === 'write_file' || toolName === 'create_directory'
        ? 'Created'
        : toolName === 'delete_file'
          ? 'Deleted'
          : toolName === 'move_file'
            ? 'Moved'
            : toolName === 'copy_file'
              ? 'Copied'
              : 'Edited'
  } else if (toolName === 'run_command') {
    category = 'command_execution'
    verb = 'Ran'
  } else if (toolName === 'run_tests') {
    category = 'test_run'
  } else if (['read_file', 'grep_search', 'list_dir', 'list_files_recursive', 'extract_code_symbols', 'get_file_info'].includes(toolName)) {
    category = 'workspace_exploration'
    verb = toolName === 'read_file' ? 'Read' : toolName === 'grep_search' ? 'Search' : toolName === 'extract_code_symbols' ? 'Symbols' : 'List'
  } else if (['web_search', 'fetch_web_content', 'download_file'].includes(toolName)) {
    category = 'web_research'
    verb = toolName === 'web_search' ? 'Search' : toolName === 'fetch_web_content' ? 'Fetch' : 'Download'
  }

  const testRunMeta =
    toolName === 'run_tests'
      ? {
          isPass: !isToolFailure,
          summary: toolRes.logMessage,
        }
      : undefined

  const structuredMeta = {
    category,
    toolName,
    target: targetParam,
    status: (isToolFailure ? 'failure' : 'success') as 'failure' | 'success',
    verb,
    testRun: testRunMeta,
  }

  if (toolRes.isTerminal) {
    ctx.emitLog('terminal', toolRes.logMessage, toolRes.logDetail, structuredMeta)
  } else {
    ctx.emitLog('info', toolRes.logMessage, toolRes.logDetail, structuredMeta)
  }

  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, parsedTool.tool, toolRes.outputForHistory, toolRes.isTerminal, toolRes.logDetail)
  }

  const terminalOutcome = terminalOutcomeFor(toolRes)
  if (terminalOutcome) {
    const closure = await ctx.closeApplicationRun({
      trigger: 'protocol_error',
      reason: { key: 'reasonUnsupportedTool', params: { tool: parsedTool.tool } },
    })
    return closure.outcome === 'closed' ? { outcome: 'return', result: closure.result } : { outcome: 'continue' }
  }

  return { outcome: 'continue' }
}
