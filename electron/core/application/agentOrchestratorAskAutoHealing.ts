import type { AgentToolCall, AgentTaskResult, AgentLogEntry } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../shared/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'

type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

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

  const historyText = ctx.compiledHistoryBlock.toLowerCase()
  const hasCancellationInHistory =
    historyText.includes('cancelled') || historyText.includes('canceled') || historyText.includes('interrupted')

  const PERMISSION_REGEX = /\b(proceed|procedere|start|iniziare|cominciare|confirm|conferma|shall we|should we|can we|do you want|would you like|vuoi che|posso)\b/i
  const TRIVIAL_PREFERENCE_REGEX = /\b(which (library|framework|styling|animation)|what (library|framework)|quale (libreria|framework)|quali (librerie|framework)|preferisci|prefer to|prefer)\b/i
  const VAGUE_WHAT_NEXT_REGEX = /\b(what next|what should (?:we|i) do|how should (?:we|i) proceed|what to do next|how to proceed|interrupted)\b/i

  const isPermissionOrProceedQuestion = PERMISSION_REGEX.test(question)
  const isTrivialPreferenceQuestion = isPermissionOrProceedQuestion || TRIVIAL_PREFERENCE_REGEX.test(question)

  const isVagueClarification =
    ctx.hasRecentToolFailure ||
    ctx.errorCountInHistory > 0 ||
    hasCancellationInHistory ||
    isTrivialPreferenceQuestion ||
    ctx.stepCount === 1 ||
    VAGUE_WHAT_NEXT_REGEX.test(question)

  if (ctx.agentMode === 'agent' && isVagueClarification && ctx.stepCount < ctx.maxSteps && ctx.stagnationStreak < ASK_REDIRECT_LIMIT) {
    const feedback = isPermissionOrProceedQuestion || ctx.stepCount === 1
      ? `[AUTONOMOUS EXECUTION DIRECTIVE: DO NOT ASK FOR PERMISSION TO PROCEED]\nYou are operating in AGENT mode. The execution plan has ALREADY been approved by the user.\nYou have FULL authorization to implement the task immediately.\nDO NOT ask "Do you want to proceed?", "Posso procedere?", or request confirmation to start.\nProceed IMMEDIATELY by executing the first milestone using write_file, replace_file_content, read_file, or run_command.`
      : isTrivialPreferenceQuestion
      ? `[AUTONOMOUS TECHNICAL DECISION DIRECTIVE: DO NOT STALL FOR TECHNICAL CHOICES]\nIn AGENT mode, you MUST autonomously select sensible standard technologies (e.g. standard CSS keyframes, GSAP, vanilla HTML5/JS, standard npm packages) and implement the requested feature directly. DO NOT ask the user for library or aesthetic preferences.\nProceed IMMEDIATELY by creating or editing the required files with write_file / replace_file_content or running build/test commands.`
      : hasCancellationInHistory
      ? `[PROACTIVE AUTO-HEALING DIRECTIVE: CLI GENERATOR CANCELLED]\nYour previous terminal command or CLI generator cancelled or was interrupted. In AGENT mode, DO NOT ask the user what to do next.\nFallback IMMEDIATELY to constructing the project files directly with write_file (e.g. package.json, index.html, src/main.tsx, src/App.tsx).`
      : historyText.includes('ast validation error') || historyText.includes('ast syntax error')
      ? `[PROACTIVE AUTO-HEALING DIRECTIVE: FIX AST SYNTAX ERROR]\nYour previous file write contained a syntax error and was blocked by pre-commit AST validation. In AGENT mode, DO NOT ask the user to fix or review your code.\nInspect the syntax error line and character reported in the error trace, and immediately reissue write_file or replace_file_content with valid, complete syntax (fix unexpected braces, unclosed tags, or malformed expressions).`
      : `[PROACTIVE AUTO-HEALING DIRECTIVE: DO NOT ASK LAZY QUESTIONS]\nYour previous tool or command encountered an error or was interrupted. In AGENT mode, you MUST NOT ask vague clarification questions to the user.\nInspect the error trace in your episodic history, analyze the root cause (e.g. missing dependency, syntax error, path issue, or process timeout), and immediately issue a corrective tool call (such as run_command with a fix, read_file, list_dir, or replace_file_content) to resolve the issue autonomously.`
    ctx.episodicCompactor.recordStep(
      {
        step: ctx.stepCount,
        tool: 'ask',
        status: 'BLOCKED',
        summary: 'Auto-Healing Interception: Intercepted lazy clarification or permission request in AGENT mode',
      },
      feedback
    )
    ctx.emitLog(
      'info',
      `⚡ Proactive Auto-Healing: Intercettata richiesta di permesso/chiarimento ridondante. L'agente procede direttamente con l'implementazione.`
    )
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, 'ask', feedback)
    }
    return { outcome: 'continue', stagnationStreak: ctx.stagnationStreak + 1 }
  }

  // A vague clarification that ran out of redirect budget is the model giving up after being
  // stuck, not a genuine question -- the session must not be recorded as a success.
  const gaveUpWhileStuck = isVagueClarification && ctx.stagnationStreak >= ASK_REDIRECT_LIMIT
  ctx.emitLog('info', `❓ AI Agent Question: ${question}`, undefined, {
    category: 'agent_question',
  })
  ctx.emitDone(!gaveUpWhileStuck, question)
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolCall(ctx.sessionId, ctx.stepCount, 'ask', parsedTool.parameters, parsedTool.explanation)
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, !gaveUpWhileStuck, question)
  }
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: !gaveUpWhileStuck, summary: question } }
}
