import type { AgentToolCall } from '../domain/agent/agentTypes'
import type { ToolExecutionResult } from './agentToolExecutorService'
import { DiagnosticOutputReducer } from '../domain/agent/diagnosticOutputReducer'
import { extractErrorDiagnostics, formatDiagnosticPrompt } from '../domain/agent/astStackTraceExtractor'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { runCircuitBreaker, recordMutationSideEffects, trackVerification } from './agentOrchestratorCircuitBreakerAndVerification'
import type { ToolResultProcessingContext, ToolResultProcessingOutcome } from './agentOrchestratorToolResultTypes'

export type { ToolResultMutableFlags, ToolResultProcessingContext, ToolResultProcessingOutcome } from './agentOrchestratorToolResultTypes'

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
 * Post-processes a tool execution result: change-metrics IPC, stagnation circuit breaker
 * (which may end the session), episodic recording, mutation/verification bookkeeping (see
 * agentOrchestratorCircuitBreakerAndVerification.ts), and the final tool-result log line.
 * Mirrors the exact step order from the original inline loop body.
 */
export async function runToolResultProcessing(ctx: ToolResultProcessingContext): Promise<ToolResultProcessingOutcome> {
  const { toolRes, parsedTool } = ctx
  const isToolFailure =
    toolRes.outputForHistory.includes('[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]') ||
    toolRes.outputForHistory.includes('[REPLACE FILE ERROR') ||
    toolRes.outputForHistory.includes('Security Violation') ||
    toolRes.outputForHistory.toLowerCase().startsWith('error:')

  const targetParam = extractTargetParam(parsedTool)
  const distilledOutput = distillOutput(toolRes, isToolFailure)

  emitChangeMetrics(ctx)

  const isMutating = ['write_file', 'replace_file_content', 'multi_replace_file_content', 'delete_file', 'download_file'].includes(parsedTool.tool)
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

  if (isMutating && !isToolFailure) {
    await recordMutationSideEffects(ctx, targetParam)
  }
  trackVerification(ctx, isToolFailure)

  if (toolRes.isTerminal) {
    ctx.emitLog('terminal', toolRes.logMessage, toolRes.logDetail)
  } else {
    ctx.emitLog('info', toolRes.logMessage, toolRes.logDetail)
  }

  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, parsedTool.tool, toolRes.outputForHistory, toolRes.isTerminal, toolRes.logDetail)
  }

  return { outcome: 'continue' }
}
