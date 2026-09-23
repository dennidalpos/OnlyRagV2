import type { AgentToolCall, AgentTaskResult, AgentLogEntry } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AgentGuardEvent, AppSettings } from '../../../shared/types'
import { recordGuardEvent } from '../domain/agent/agentGuardEvents'
import type { AgentProgressPolicy } from '../domain/agent/agentProgressPolicy'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { ApplicationClosureOutcome, ApplicationClosureRequest } from './agentOrchestratorApplicationClosureTypes'

type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string, meta?: Partial<AgentLogEntry>) => void

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
  /** Shared with the loop guard: redirects and loop blocks draw on the same streak, so a model can't dodge an exhausted write-loop budget by asking. */
  progress: AgentProgressPolicy
  guardEvents: AgentGuardEvent[]
  episodicCompactor: EpisodicMemoryCompactor
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string) => void
  persistCurrentState: () => Promise<void>
  finalizeSession: () => void
  closeApplicationRun: (request: ApplicationClosureRequest) => Promise<ApplicationClosureOutcome>
}

export type AskToolOutcome = { outcome: 'continue' } | { outcome: 'return'; result: AgentTaskResult }

/** In Auto mode, intercepts vague clarification after a failure and redirects the model to recovery. */
export async function handleAskTool(ctx: AskToolContext): Promise<AskToolOutcome> {
  const { parsedTool } = ctx
  const question = parsedTool.parameters?.question || parsedTool.parameters?.query || parsedTool.explanation || 'Clarification requested from user.'

  const historyText = ctx.compiledHistoryBlock.toLowerCase()
  const hasCancellationInHistory = historyText.includes('cancelled') || historyText.includes('canceled') || historyText.includes('interrupted')

  const PERMISSION_REGEX =
    /\b(proceed|procedere|start|iniziare|cominciare|confirm|conferma|shall we|should we|can we|do you want|would you like|vuoi che|posso)\b/i
  const TRIVIAL_PREFERENCE_REGEX =
    /\b(which (library|framework|styling|animation)|what (library|framework)|quale (libreria|framework)|quali (librerie|framework)|preferisci|prefer to|prefer)\b/i
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

  if (ctx.agentMode === 'auto' && isVagueClarification && ctx.stepCount < ctx.maxSteps && ctx.progress.tryAskRedirect()) {
    const feedback =
      isPermissionOrProceedQuestion || ctx.stepCount === 1
        ? `[AUTONOMOUS EXECUTION DIRECTIVE: DO NOT ASK FOR PERMISSION TO PROCEED]\nYou are operating in AUTO mode. The task is authorized for trusted local execution.\nDO NOT ask for confirmation to start. Proceed with the first milestone.`
        : isTrivialPreferenceQuestion
          ? `[AUTONOMOUS TECHNICAL DECISION DIRECTIVE: DO NOT STALL FOR TECHNICAL CHOICES]\nIn AUTO mode, select sensible standard technologies and implement directly. Ask only for a genuine business decision.`
          : hasCancellationInHistory
            ? `[PROACTIVE AUTO-HEALING DIRECTIVE: CLI GENERATOR CANCELLED]\nYour previous command was interrupted. In AUTO mode, change strategy and continue without asking what to do next.`
            : historyText.includes('ast validation error') || historyText.includes('ast syntax error')
              ? `[PROACTIVE AUTO-HEALING DIRECTIVE: FIX AST SYNTAX ERROR]\nInspect the reported syntax error and issue a corrected edit in AUTO mode.`
              : `[PROACTIVE AUTO-HEALING DIRECTIVE: DO NOT ASK LAZY QUESTIONS]\nInspect the failure, change strategy, and issue a corrective tool call in AUTO mode.`
    recordGuardEvent(ctx.guardEvents, 'ask_redirect', 'advise', ctx.stepCount)
    ctx.episodicCompactor.recordStep(
      {
        step: ctx.stepCount,
        tool: 'ask',
        status: 'BLOCKED',
        summary: 'Auto-Healing Interception: intercepted a redundant clarification in AUTO mode',
      },
      feedback,
    )
    ctx.emitLog(
      'info',
      `⚡ Proactive Auto-Healing: Intercettata richiesta di permesso/chiarimento ridondante. L'agente procede direttamente con l'implementazione.`,
    )
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, 'ask', feedback)
    }
    return { outcome: 'continue' }
  }

  // A vague clarification that ran out of redirect budget is the model giving up after being
  // stuck, not a genuine question -- the session must not be recorded as a success.
  const gaveUpWhileStuck = isVagueClarification && ctx.progress.askRedirectsExhausted()
  ctx.emitLog('info', `❓ AI Agent Question: ${question}`, undefined, {
    category: 'agent_question',
  })
  if (ctx.agentMode === 'auto') {
    const closure = await ctx.closeApplicationRun({
      trigger: 'guard_stop',
      ...(gaveUpWhileStuck ? { guard: 'ask_redirect' as const } : {}),
      reason: gaveUpWhileStuck
        ? 'Il modello ha esaurito il recupero automatico e richiede intervento.'
        : "Il modello richiede una decisione dell'utente prima di proseguire.",
      modelSummary: question,
    })
    return closure.outcome === 'closed' ? { outcome: 'return', result: closure.result } : { outcome: 'continue' }
  }

  ctx.emitDone(!gaveUpWhileStuck, question)
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolCall(ctx.sessionId, ctx.stepCount, 'ask', parsedTool.parameters, parsedTool.explanation)
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, !gaveUpWhileStuck, question)
  }
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: !gaveUpWhileStuck, summary: question } }
}
