import type { AgentToolCall, AgentLogEntry } from '../domain/agent/agentTypes'
import type { ToolExecutionResult } from './agentToolExecutorService'
import {
  DiagnosticOutputReducer,
  extractErrorDiagnostics,
  formatDiagnosticPrompt,
} from '../domain/agent/diagnosticOutputReducer'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { runCircuitBreaker, recordMutationSideEffects, recordCommandTouchedFiles, trackVerification } from './agentOrchestratorCircuitBreakerAndVerification'
import type { ToolResultProcessingContext, ToolResultProcessingOutcome } from './agentOrchestratorToolResultTypes'

export type { ToolResultMutableFlags, ToolResultProcessingContext, ToolResultProcessingOutcome } from './agentOrchestratorToolResultTypes'

export function terminalOutcomeFor(toolRes: ToolExecutionResult): ToolResultProcessingOutcome | null {
  if (toolRes.terminalCode !== 'MODEL_UNSUITABLE') return null
  return { outcome: 'return', result: { success: false, summary: toolRes.outputForHistory } }
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

function distillOutput(toolRes: ToolExecutionResult, isToolFailure: boolean): string {
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
  if (ctx.isSessionActive() && ctx.targetWindow && !ctx.targetWindow.isDestroyed()) {
    ctx.targetWindow.webContents.send('agent:change-metrics', {
      filesTouched: ctx.sessionChangedFiles.size,
      additions: totalAdditions,
      deletions: totalDeletions,
    })
  }
}

/**
 * Whether a tool result reports a failure.
 *
 * A whitelist of markers rather than a flag on ToolExecutionResult, because that is what the
 * loop has always used and every producer already emits these strings. What matters is that
 * the list is complete: the label is read three times over — `recordOutcome` feeds it to the
 * loop detector, only failures enter the buffer that survives FIFO trimming, and the
 * trajectory table prints it for whoever reads the run.
 *
 * The AST marker was missing. Live run of 2026-08-24, steps 46, 47, 49 and 50: four writes
 * rejected by the pre-commit AST check, none of which reached the disk, all four recorded as
 * SUCCESS. The model was consequently handed the redundancy directive — whose text says "this
 * is NOT a failure and it is NOT counted against you" — about a file that did not exist.
 */
export function isFailureOutput(outputForHistory: string): boolean {
  const output = outputForHistory || ''
  return (
    output.includes('[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]') ||
    output.includes('[REPLACE FILE ERROR') ||
    output.includes('[PRE-COMMIT AST VALIDATION ERROR IN') ||
    // A refused install is a failed install. The registry guard in agentToolExecutorService.ts
    // returns this marker WITHOUT running npm, and because it was absent from this list the
    // refusal was recorded as SUCCESS — which packagesWithFailedInstall (installCommandParser.ts)
    // reads as "this package installed fine" and uses to RESET the package's failure count to
    // zero. The count could therefore never reach FAILURES_BEFORE_UNINSTALLABLE, the arbiter
    // never reached `dependencies_uninstallable`, and it went on ordering the same impossible
    // install every turn while the guard went on refusing it.
    //
    // Measured in logs/coding_agent_audit.log, session live-full-task 2026-08-25T11:03: the
    // model was ordered to install "@tailwindcss/react" (a package that does not exist) at
    // steps 9, 11, 18, 19, 25, 26, 32, 33, 39, 40, 46 and 48, with the loop detector blocking
    // the turns in between, until the 50-step cap ended the session with 0 milestones verified.
    // The 08:37 run of the same day did the same. The escape those runs needed was already
    // built and simply never armed.
    output.includes('[PACKAGE DOES NOT EXIST') ||
    output.includes('[VERSION DOWNGRADE REFUSED') ||
    output.includes('Security Violation') ||
    output.toLowerCase().startsWith('error:')
  )
}

/**
 * Post-processes a tool execution result: change-metrics IPC, stagnation circuit breaker
 * (which may end the session), episodic recording, mutation/verification bookkeeping (see
 * agentOrchestratorCircuitBreakerAndVerification.ts), and the final tool-result log line.
 * Mirrors the exact step order from the original inline loop body.
 */
export async function runToolResultProcessing(ctx: ToolResultProcessingContext): Promise<ToolResultProcessingOutcome> {
  const { toolRes, parsedTool } = ctx
  const isToolFailure = isFailureOutput(toolRes.outputForHistory)

  const targetParam = extractTargetParam(parsedTool)
  const distilledOutput = distillOutput(toolRes, isToolFailure)

  // Closes the loop detector's feedback path: it records INTENT before the tool runs, and only
  // this line tells it what actually happened. Without it every repeat looks like a failing
  // one, and a command that keeps succeeding gets its milestone abandoned as FAILED.
  ctx.loopDetector.recordOutcome(parsedTool, !isToolFailure)

  emitChangeMetrics(ctx)

  // Classified by tool name, then corrected by what the tool actually did: a `write_file`
  // whose content was already on disk mutated nothing, and treating it as a mutation cleared
  // the verified-build flag and re-advanced milestones on evidence that had not changed. See
  // redundantWriteDetector.ts.
  const isMutating =
    ['write_file', 'replace_file_content', 'multi_replace_file_content', 'delete_file', 'download_file'].includes(parsedTool.tool) &&
    !toolRes.noOpMutation
  const breakerOutcome = await runCircuitBreaker(ctx, isMutating, isToolFailure)
  if (breakerOutcome) return breakerOutcome

  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: parsedTool.tool,
      target: targetParam,
      status: isToolFailure ? 'FAILURE' : 'SUCCESS',
      summary: toolRes.logMessage,
    },
    distilledOutput
  )

  if (!isToolFailure && ctx.flags.currentOverriddenModel) {
    ctx.flags.currentOverriddenModel = null
  }

  if (isMutating && !isToolFailure) {
    await recordMutationSideEffects(ctx, targetParam)
  }
  // Runs on failure too: a generator that aborts halfway still leaves directories behind,
  // and that leftover is precisely what the agent needs to be told about.
  recordCommandTouchedFiles(ctx, isToolFailure)
  trackVerification(ctx, isToolFailure)

  const toolName = parsedTool.tool
  let category: AgentLogEntry['category'] = 'tool_execution'
  let verb: AgentLogEntry['verb'] = undefined

  if (toolRes.noOpMutation) {
    // Nothing was created or edited, so the panel must not claim it was: the agent log is the
    // user's account of what the run did to their workspace. `logMessage` already says so.
    category = 'tool_execution'
  } else if (['write_file', 'replace_file_content', 'multi_replace_file_content', 'delete_file', 'copy_file', 'move_file', 'create_directory'].includes(toolName)) {
    category = 'file_mutation'
    verb = toolName === 'write_file' || toolName === 'create_directory'
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

  const testRunMeta = toolName === 'run_tests' ? {
    isPass: !isToolFailure,
    summary: toolRes.logMessage,
  } : undefined

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
  if (terminalOutcome) return terminalOutcome

  return { outcome: 'continue' }
}
