import { GoalDecompositionPlanner, isCompletionMilestoneTitle } from '../../../shared/domain/agent/planAndSolveGraph'
import { compilePlanMilestones } from '../../../shared/domain/agent/planCompilation'
import { parseAgentToolCall, type ToolCallRejection } from '../domain/agent/toolParser'
import { buildToolSchemaCorrectionDirective } from '../domain/agent/ollamaToolSchemaCatalog'
import {
  buildToolSwitchDirective,
  rejectionAbortSummary,
  resolveToolRejectionAction,
} from '../domain/agent/toolRejectionEscalation'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { handleAskTool } from './agentOrchestratorAskAutoHealing'
import { handleFinishTool, handleLoopDetection } from './agentOrchestratorFinishAndLoopGuards'
import type { ResponseInterpreterContext, ResponseInterpretationOutcome } from './agentOrchestratorResponseInterpreterTypes'

export type { ResponseInterpreterContext, ResponseInterpretationOutcome } from './agentOrchestratorResponseInterpreterTypes'

/**
 * Without a plan yet, any checklist-shaped output seeds one. With a plan already in place,
 * only an explicit <plan> block may replace it — a stray numbered list in prose must not
 * clobber the active plan — and the replacement carries over the milestones already verified
 * or failed, so re-planning never resets progress to 0%.
 */
async function extractOrRevisePlan(ctx: ResponseInterpreterContext) {
  const outputText = ctx.streamedOutput || ''
  const hasExplicitPlanBlock = outputText.includes('<plan>')
  if (!ctx.goalPlanner.hasPlan() && (hasExplicitPlanBlock || outputText.includes('- [ ]') || outputText.includes('1. '))) {
    // The >= 2 threshold asks "did the model actually emit a checklist?", so it is applied to
    // the PARSED milestones. Applying it after compilation would let a two-item plan whose
    // second item is an acceptance criterion fold to one entry and then be discarded whole.
    const parsedMilestones = GoalDecompositionPlanner.parsePlanFromText(outputText)
    if (parsedMilestones.length >= 2) {
      const extractedMilestones = compilePlanMilestones(parsedMilestones)
      // A brand-new plan can only ever start pending: parsePlanFromText's checkbox status
      // (verified/in_progress/failed) is meant for RE-parsing a plan that was already running
      // (resume, revision). Trusting it here would let a model that mistakenly echoes "[x]"
      // on its first turn seed a plan that's already 100% "done" -- compileProgressPrompt then
      // orders it to call finish immediately, closing the task without doing any work.
      ctx.goalPlanner.initializePlan(extractedMilestones.map((m) => ({ ...m, status: 'pending' })))
      ctx.emitLog('info', `📋 Execution Plan Initialized (${extractedMilestones.length} milestones)`)
      // The plan is written out in full exactly when it changes shape -- here and on revision
      // below. Per-step snapshots were removed; individual status changes are logged as
      // transitions instead (see agentOrchestratorSessionPersistence.ts).
      if (ctx.settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logPlanMilestoneUpdate(ctx.sessionId, ctx.stepCount, [...ctx.goalPlanner.getMilestones()], 'Plan initialized')
      }
    }
    return
  }
  if (ctx.goalPlanner.hasPlan() && hasExplicitPlanBlock) {
    const parsedRevision = GoalDecompositionPlanner.parsePlanFromText(ctx.streamedOutput)
    if (parsedRevision.length >= 2) {
      const revisedMilestones = compilePlanMilestones(parsedRevision)
      ctx.goalPlanner.replacePlanPreservingProgress(revisedMilestones)
      const progress = ctx.goalPlanner.getProgressSummary()
      ctx.emitLog(
        'info',
        `📋 Execution Plan Revised (${revisedMilestones.length} milestones, ${progress.completed} already verified carried over)`
      )
      if (ctx.settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logPlanMilestoneUpdate(ctx.sessionId, ctx.stepCount, [...ctx.goalPlanner.getMilestones()], 'Plan revised')
      }
      await ctx.persistCurrentState()
    }
  }
}

async function handleMissingToolCall(
  ctx: ResponseInterpreterContext,
  rejections: readonly ToolCallRejection[] = []
): Promise<ResponseInterpretationOutcome> {
  const streamedOutput = ctx.streamedOutput || ''
  const hasToolCallAttempt =
    rejections.length > 0 ||
    streamedOutput.includes('<tool_call>') || streamedOutput.includes('```json') || streamedOutput.toLowerCase().includes('"tool"')

  if (hasToolCallAttempt) {
    // This branch used to return `continue` without incrementing anything, and the loop
    // detector never sees these calls because validation rejects them before it runs. The
    // result was a path with no escalation and no terminating guarantee: thirty-three
    // consecutive rejected `replace_file_content` calls in the live run of 2026-08-24, zero
    // loop interventions in the whole audit log, and a session that ended only on its step cap.
    ctx.state.schemaRejectionStreak++
    const rejected = rejections[rejections.length - 1]
    const toolLabel = rejected?.toolName || 'unparsed_tool'
    const action = resolveToolRejectionAction(ctx.state.schemaRejectionStreak)

    if (action === 'abort') {
      const summary = rejectionAbortSummary(toolLabel, ctx.state.schemaRejectionStreak)
      ctx.emitLog('info', `⛔ ${summary}`, undefined, { category: 'system_alert' })
      const closure = await ctx.closeApplicationRun({
        trigger: 'protocol_error',
        reason: summary,
        modelSummary: streamedOutput,
      })
      return closure.outcome === 'closed'
        ? { outcome: 'return', result: closure.result }
        : { outcome: 'continue' }
    }

    // The tool's real contract, rendered from the schema catalogue the native tool-calling
    // path already publishes. REPLACED, not appended, once repeating it has demonstrably
    // failed: the contract is correct and was sent 97 times in that run. Sending it again is
    // not the answer; naming a tool the model can actually emit is. Same shape as the ladder
    // in loopEscapePolicy.ts.
    const feedback =
      action === 'switch_tool' && rejected
        ? buildToolSwitchDirective(toolLabel, ctx.state.schemaRejectionStreak)
        : rejected
          ? buildToolSchemaCorrectionDirective(rejected.toolName, rejected.errors)
          : '[TOOL PARSER REJECTION DIAGNOSTIC]\nNo tool call could be parsed from your response. Emit exactly ONE fenced json block containing "tool", "parameters" and "explanation".'
    ctx.episodicCompactor.recordStep(
      {
        step: ctx.stepCount,
        tool: toolLabel,
        // Carries the tool name as target so the episodic buffer collapses the repeats onto one
        // slot instead of spending the whole recent-outputs window on them.
        target: toolLabel,
        status: 'BLOCKED',
        summary: rejected
          ? `Tool call rejected (${ctx.state.schemaRejectionStreak}x): ${rejected.errors.join('; ').slice(0, 100)}`
          : 'Tool call rejected: no parsable JSON tool call',
      },
      feedback
    )
    ctx.emitLog(
      'info',
      rejected
        ? `Step ${ctx.stepCount} Tool Call Rejected [${rejected.toolName}] (${ctx.state.schemaRejectionStreak}x): ${rejected.errors.join('; ')}`
        : `Step ${ctx.stepCount} Tool Call Rejected: no parsable JSON tool call.`
    )
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, toolLabel, feedback)
    }
    return { outcome: 'continue' }
  }

  const hasOperationalWork = !ctx.goalPlanner.hasPlan() || ctx.goalPlanner.getMilestones().some(
    (milestone) =>
      !isCompletionMilestoneTitle(milestone.title) &&
      (milestone.status === 'pending' || milestone.status === 'in_progress')
  )

  // If operational work remains, give prose-only output two chances to turn into an action.
  // Once the plan is closed, the prose itself can be the final report and the application
  // immediately evaluates evidence without demanding a ceremonial finish call.
  if (ctx.agentMode === 'agent' && hasOperationalWork && ctx.stepCount < ctx.maxSteps && ctx.state.noToolStreak < 2) {
    ctx.state.noToolStreak++
    const feedback = `[ACTION REQUIRED: NO TOOL INVOCATION DETECTED]\nYour previous response was purely descriptive while operational work is still open. Invoke one concrete tool for the current milestone. When the work is actually complete, provide the final report as prose: the application will run the final evidence gate and close the session.`
    ctx.episodicCompactor.recordStep(
      { step: ctx.stepCount, tool: 'no_tool_detected', status: 'BLOCKED', summary: 'No tool call found in conversational response' },
      feedback
    )
    ctx.emitLog('info', `Step ${ctx.stepCount}: No tool call found in LLM response. Requesting tool invocation...`)
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, 'no_tool_detected', feedback)
    }
    return { outcome: 'continue' }
  }

  const summary = streamedOutput.trim() || 'Task completed successfully.'

  // In CHAT mode a prose answer with no tool call IS the deliverable: the turn is done.
  if (ctx.agentMode !== 'agent') {
    agentToolExecutorService.commitJournal()
    ctx.emitLog('info', `Task Finished: ${summary.slice(0, 300)}`)
    ctx.emitDone(true, summary)
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, true, summary)
    }
    await ctx.persistCurrentState()
    ctx.finalizeSession()
    return { outcome: 'return', result: { success: true, summary } }
  }

  const closure = await ctx.closeApplicationRun({
    trigger: 'model_silence',
    reason: hasOperationalWork
      ? 'Il modello ha smesso di invocare strumenti mentre restava lavoro operativo aperto.'
      : 'Il modello ha consegnato il riepilogo finale senza richiedere un tool di chiusura.',
    modelSummary: summary,
  })
  return closure.outcome === 'closed'
    ? { outcome: 'return', result: closure.result }
    : { outcome: 'continue' }
}

/**
 * Interprets one turn's raw LLM output: plan extraction, tool-call parsing (with the
 * no-tool-call / malformed-call recovery paths), the finish/loop-detection/ask special
 * cases (see agentOrchestratorFinishAndLoopGuards.ts and agentOrchestratorAskAutoHealing.ts),
 * and finally the "about to execute" log line for whatever tool call survives all of the
 * above. Mirrors the exact step order from the original inline loop body.
 */
export async function interpretTurnResponse(ctx: ResponseInterpreterContext): Promise<ResponseInterpretationOutcome> {
  await extractOrRevisePlan(ctx)

  const rejections: ToolCallRejection[] = []
  const parsedTool = parseAgentToolCall(ctx.streamedOutput, (rejection) => rejections.push(rejection))
  if (!parsedTool) return handleMissingToolCall(ctx, rejections)

  ctx.state.noToolStreak = 0
  // A call that parses ends any rejection streak: the model has produced a valid shape again.
  ctx.state.schemaRejectionStreak = 0

  if (parsedTool.tool === 'finish') return handleFinishTool(ctx, parsedTool)

  const loopOutcome = await handleLoopDetection(ctx, parsedTool)
  if (loopOutcome) return loopOutcome

  if (parsedTool.tool === 'ask') {
    // Deliberately does NOT reset stagnationStreak first: "ask" isn't forward progress, so a
    // model that just burned through a write-loop's stagnation budget and pivots to asking
    // inherits that same streak instead of getting a fresh grace period (see
    // agentOrchestratorAskAutoHealing.ts).
    const askOutcome = await handleAskTool({
      parsedTool,
      agentMode: ctx.agentMode,
      stepCount: ctx.stepCount,
      maxSteps: ctx.maxSteps,
      sessionId: ctx.sessionId,
      settings: ctx.settings,
      hasRecentToolFailure: ctx.hasRecentToolFailure,
      errorCountInHistory: ctx.errorCountInHistory,
      compiledHistoryBlock: ctx.compiledHistoryBlock,
      stagnationStreak: ctx.state.stagnationStreak,
      episodicCompactor: ctx.episodicCompactor,
      emitLog: ctx.emitLog,
      emitDone: ctx.emitDone,
      persistCurrentState: ctx.persistCurrentState,
      finalizeSession: ctx.finalizeSession,
    })
    if (askOutcome.outcome === 'continue') {
      ctx.state.stagnationStreak = askOutcome.stagnationStreak
      return { outcome: 'continue' }
    }
    return askOutcome
  }

  ctx.state.stagnationStreak = 0
  ctx.state.redundantSuccessStreak = 0

  ctx.emitLog('tool_call', `Step ${ctx.stepCount} Tool Call [${parsedTool.tool}]:`, JSON.stringify(parsedTool.parameters, null, 2))
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolCall(ctx.sessionId, ctx.stepCount, parsedTool.tool, parsedTool.parameters, parsedTool.explanation)
  }
  return { outcome: 'proceed', parsedTool }
}
