import { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { handleAskTool } from './agentOrchestratorAskAutoHealing'
import { handleFinishTool, handleLoopDetection } from './agentOrchestratorFinishAndLoopGuards'
import type { ResponseInterpreterContext, ResponseInterpretationOutcome } from './agentOrchestratorResponseInterpreterTypes'

export type { ResponseInterpreterState, ResponseInterpreterContext, ResponseInterpretationOutcome } from './agentOrchestratorResponseInterpreterTypes'

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
    const extractedMilestones = GoalDecompositionPlanner.parsePlanFromText(outputText)
    if (extractedMilestones.length >= 2) {
      // A brand-new plan can only ever start pending: parsePlanFromText's checkbox status
      // (verified/in_progress/failed) is meant for RE-parsing a plan that was already running
      // (resume, revision). Trusting it here would let a model that mistakenly echoes "[x]"
      // on its first turn seed a plan that's already 100% "done" -- compileProgressPrompt then
      // orders it to call finish immediately, closing the task without doing any work.
      ctx.goalPlanner.initializePlan(extractedMilestones.map((m) => ({ ...m, status: 'pending' })))
      ctx.emitLog('info', `📋 Execution Plan Initialized (${extractedMilestones.length} milestones)`)
    }
    return
  }
  if (ctx.goalPlanner.hasPlan() && hasExplicitPlanBlock) {
    const revisedMilestones = GoalDecompositionPlanner.parsePlanFromText(ctx.streamedOutput)
    if (revisedMilestones.length >= 2) {
      ctx.goalPlanner.replacePlanPreservingProgress(revisedMilestones)
      const progress = ctx.goalPlanner.getProgressSummary()
      ctx.emitLog(
        'info',
        `📋 Execution Plan Revised (${revisedMilestones.length} milestones, ${progress.completed} already verified carried over)`
      )
      await ctx.persistCurrentState()
    }
  }
}

async function handleMissingToolCall(ctx: ResponseInterpreterContext): Promise<ResponseInterpretationOutcome> {
  const streamedOutput = ctx.streamedOutput || ''
  const hasToolCallAttempt =
    streamedOutput.includes('<tool_call>') || streamedOutput.includes('```json') || streamedOutput.toLowerCase().includes('"tool"')

  if (hasToolCallAttempt) {
    const feedback = `[TOOL PARSER REJECTION DIAGNOSTIC]\nYour tool call could not be executed because mandatory input parameters were missing or malformed.\nPlease ensure you provide valid JSON with all required parameters.`
    ctx.episodicCompactor.recordStep(
      { step: ctx.stepCount, tool: 'unparsed_tool', status: 'BLOCKED', summary: 'Tool call rejected: missing mandatory JSON parameters' },
      feedback
    )
    ctx.emitLog('info', `Step ${ctx.stepCount} Tool Call Rejected: Missing required parameters in JSON payload.`)
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, 'unparsed_tool', feedback)
    }
    return { outcome: 'continue' }
  }

  // In AGENT mode, if the model gave conversational text without invoking any tool, prompt it
  // up to 2 times to execute a tool instead of exiting prematurely.
  if (ctx.agentMode === 'agent' && ctx.stepCount < ctx.maxSteps && ctx.state.noToolStreak < 2) {
    ctx.state.noToolStreak++
    const feedback = `[ACTION REQUIRED: NO TOOL INVOCATION DETECTED]\nYour previous response was purely descriptive and did not invoke any tools. In AGENT mode, to create or edit files in the workspace, you MUST output a tool call formatted as:\n\`\`\`json\n{\n  "tool": "write_file",\n  "parameters": {\n    "filePath": "index.html",\n    "content": "..."\n  },\n  "explanation": "Creating initial project file"\n}\n\`\`\`\nIf all work is finished, invoke the "finish" tool. Please invoke the required tool now.`
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

  agentToolExecutorService.commitJournal()
  const summary = streamedOutput.trim() || 'Task completed successfully.'
  ctx.emitLog('info', `Task Finished: ${summary.slice(0, 300)}`)
  ctx.emitDone(true, summary)
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, true, summary)
  }
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: true, summary } }
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

  const parsedTool = parseAgentToolCall(ctx.streamedOutput)
  if (!parsedTool) return handleMissingToolCall(ctx)

  ctx.state.noToolStreak = 0

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

  ctx.emitLog('tool_call', `Step ${ctx.stepCount} Tool Call [${parsedTool.tool}]:`, JSON.stringify(parsedTool.parameters, null, 2))
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolCall(ctx.sessionId, ctx.stepCount, parsedTool.tool, parsedTool.parameters, parsedTool.explanation)
  }
  return { outcome: 'proceed', parsedTool }
}
