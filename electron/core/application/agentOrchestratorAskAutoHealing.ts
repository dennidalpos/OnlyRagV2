import type { AgentToolCall, AgentTaskResult } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'

type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => void

export interface AskToolContext {
  parsedTool: AgentToolCall
  agentMode: AgentExecutionMode
  stepCount: number
  maxSteps: number
  sessionId: string
  settings: AppSettings
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
  /** Shared with the write/edit loop detector (see ResponseInterpreterState.stagnationStreak):
   *  how many consecutive stuck-recovery interventions (loop blocks or lazy-ask redirects) have
   *  already fired this streak, so a model can't dodge an exhausted write-loop budget by simply
   *  switching to "ask". */
  stagnationStreak: number
  episodicCompactor: EpisodicMemoryCompactor
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string) => void
  persistCurrentState: () => Promise<void>
  finalizeSession: () => void
}

export type AskToolOutcome =
  | { outcome: 'continue'; stagnationStreak: number }
  | { outcome: 'return'; result: AgentTaskResult }

const ASK_REDIRECT_LIMIT = 2

/**
 * Proactive Auto-Healing Enforcement: in AGENT mode, a vague clarification request that
 * follows a tool/command failure (or a cancelled/interrupted terminal run) is intercepted up
 * to ASK_REDIRECT_LIMIT times against the shared stagnation streak, redirecting the model to
 * self-correct instead of stalling on the user. Otherwise the question is surfaced to the user
 * as the session's end-of-turn result -- marked as a failed outcome (not success) whenever it
 * was a stuck model giving up rather than a genuine, unprompted clarification request.
 */
export async function handleAskTool(ctx: AskToolContext): Promise<AskToolOutcome> {
  const { parsedTool } = ctx
  const question = parsedTool.parameters?.question || parsedTool.parameters?.query || parsedTool.explanation || 'Clarification requested from user.'
  const qLower = question.toLowerCase()

  const historyText = ctx.compiledHistoryBlock.toLowerCase()
  const hasCancellationInHistory =
    historyText.includes('cancelled') || historyText.includes('canceled') || historyText.includes('interrupted')

  const isVagueClarification =
    ctx.hasRecentToolFailure ||
    ctx.errorCountInHistory > 0 ||
    hasCancellationInHistory ||
    qLower.includes('interrupted') ||
    qLower.includes('what next') ||
    qLower.includes('what should we do') ||
    qLower.includes('how should we proceed') ||
    qLower.includes('what to do next') ||
    qLower.includes('how to proceed')

  if (ctx.agentMode === 'agent' && isVagueClarification && ctx.stepCount < ctx.maxSteps && ctx.stagnationStreak < ASK_REDIRECT_LIMIT) {
    const feedback = hasCancellationInHistory
      ? `[PROACTIVE AUTO-HEALING DIRECTIVE: CLI GENERATOR CANCELLED]\nYour previous terminal command or CLI generator cancelled or was interrupted. In AGENT mode, DO NOT ask the user what to do next.\nFallback IMMEDIATELY to constructing the project files directly with write_file (e.g. package.json, index.html, src/main.tsx, src/App.tsx).`
      : `[PROACTIVE AUTO-HEALING DIRECTIVE: DO NOT ASK LAZY QUESTIONS]\nYour previous tool or command encountered an error or was interrupted. In AGENT mode, you MUST NOT ask vague clarification questions to the user.\nInspect the error trace in your episodic history, analyze the root cause (e.g. missing dependency, syntax error, path issue, or process timeout), and immediately issue a corrective tool call (such as run_command with a fix, read_file, list_dir, or replace_file_content) to resolve the issue autonomously.`
    ctx.episodicCompactor.recordStep(
      {
        step: ctx.stepCount,
        tool: 'ask',
        status: 'BLOCKED',
        summary: 'Auto-Healing Interception: Intercepted lazy clarification question after command failure',
      },
      feedback
    )
    ctx.emitLog(
      'info',
      `⚡ Proactive Auto-Healing: Intercettata richiesta di chiarimento pigra dopo errore/interruzione. L'agente sta analizzando l'errore per risolverlo autonomamente.`
    )
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, 'ask', feedback)
    }
    return { outcome: 'continue', stagnationStreak: ctx.stagnationStreak + 1 }
  }

  // A vague clarification that ran out of redirect budget is the model giving up after being
  // stuck, not a genuine question -- the session must not be recorded as a success.
  const gaveUpWhileStuck = isVagueClarification && ctx.stagnationStreak >= ASK_REDIRECT_LIMIT
  ctx.emitLog('info', `❓ AI Agent Question: ${question}`)
  ctx.emitDone(!gaveUpWhileStuck, question)
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolCall(ctx.sessionId, ctx.stepCount, 'ask', parsedTool.parameters, parsedTool.explanation)
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, !gaveUpWhileStuck, question)
  }
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: !gaveUpWhileStuck, summary: question } }
}
