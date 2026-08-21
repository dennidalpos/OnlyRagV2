import type { AgentToolCall } from '../domain/agent/agentTypes'
import { agentToolExecutorService } from './agentToolExecutorService'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { ResponseInterpreterContext, ResponseInterpretationOutcome } from './agentOrchestratorResponseInterpreterTypes'

/**
 * Definition of Done (DoD) Execution Guard Gate. Each distinct violation reason intercepts
 * finish AT MOST ONCE (tracked in surfacedDodReasons): the guard's job is to make the model
 * aware of the missing verification, not to deadlock the session when milestone statuses
 * can't advance (milestone progression is still heuristic).
 */
export async function handleFinishTool(ctx: ResponseInterpreterContext, parsedTool: AgentToolCall): Promise<ResponseInterpretationOutcome> {
  if (ctx.agentMode === 'agent') {
    const pendingMilestonesCount = ctx.goalPlanner.getMilestones().filter((m) => m.status !== 'verified').length

    // Critical Early-Finish Defense:
    // If the model tries to finish immediately at step 1 or 2 with 0 file mutations and multiple pending milestones (>1),
    // and has not executed any mutating tool, block it and force it to take action.
    const isPrematureStart = ctx.stepCount <= 2 && !ctx.flags.hasFileMutations && pendingMilestonesCount > 1
    if (isPrematureStart && !ctx.surfacedDodReasons.has('premature_start')) {
      ctx.surfacedDodReasons.add('premature_start')
      const zeroMutationIntervention = `[CRITICAL EXECUTION ERROR: PREMATURE FINISH WITH ZERO WORK DONE]\nYou have NOT created or modified any files yet in this workspace (0 files touched).\nYou are STRICTLY FORBIDDEN from calling the "finish" tool at this stage.\nDirectives:\n1. You MUST begin implementing the first milestone immediately.\n2. Create the necessary project files (e.g. package.json, src/App.tsx, index.html) using "write_file" or scaffold with "run_command".\n3. DO NOT invoke "finish" until your implementation is written and verified.`

      ctx.episodicCompactor.recordStep({ step: ctx.stepCount, tool: 'finish', status: 'BLOCKED', summary: 'Premature finish with 0 file mutations on session start' }, zeroMutationIntervention)
      ctx.emitLog('info', '⛔ DoD Guard: Chiusura rifiutata — Nessun file creato o modificato nel workspace.', zeroMutationIntervention, {
        category: 'system_alert',
      })
      if (ctx.settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, 'finish', zeroMutationIntervention)
      }
      return { outcome: 'continue' }
    }

    const dodCheck = ctx.executionGuard.validateTaskCompletion({
      requireVerifiedBuild: (ctx.settings as any).verifyBeforeFinish !== false,
      hasVerifiedBuild: ctx.flags.hasVerifiedBuild,
      pendingMilestonesCount,
      hasFileMutations: ctx.flags.hasFileMutations,
    })

    const dodReason = dodCheck.reason || 'Definition of Done Violation'
    const dodCategory = dodReason.includes('Unverified Milestones')
      ? 'unverified_milestones'
      : dodReason.includes('Verified Build')
      ? 'missing_build_verification'
      : dodReason

    if (!dodCheck.allowed && dodCheck.suggestedAction && !ctx.surfacedDodReasons.has(dodCategory)) {
      ctx.surfacedDodReasons.add(dodCategory)
      ctx.episodicCompactor.recordStep({ step: ctx.stepCount, tool: 'finish', status: 'BLOCKED', summary: dodReason }, dodCheck.suggestedAction)
      ctx.emitLog('info', `🔒 DoD Guard Interception: ${dodReason}`, dodCheck.suggestedAction, {
        category: 'system_alert',
      })
      if (ctx.settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, 'finish', dodCheck.suggestedAction)
      }
      return { outcome: 'continue' }
    }
  }

  agentToolExecutorService.commitJournal()
  const paramSummary = parsedTool.parameters?.summary || parsedTool.parameters?.report || parsedTool.parameters?.finalReport || parsedTool.parameters?.content
  const explanation = parsedTool.explanation
  const summary = (paramSummary && paramSummary.trim().length > 0)
    ? paramSummary.trim()
    : (explanation && explanation.trim().length > 0)
    ? explanation.trim()
    : 'Task completed successfully.'

  if (ctx.workspacePath) {
    // Same builder and same writer as every checkpoint — the final save only adds the
    // agent's closing summary on top of the live session state.
    const saved = await agentSessionStateRepository.saveSessionTrackerMarkdown(ctx.workspacePath, ctx.buildSessionTracker(summary))
    if (saved) {
      ctx.emitLog('info', '📝 Session Debt Tracker salvato in .onlyrag/assistant/SESSION_TRACKER.md')
    }
  }

  ctx.emitLog('info', `Task Finished: ${summary}`, summary, {
    category: 'final_report',
  })
  ctx.emitDone(true, summary)
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolCall(ctx.sessionId, ctx.stepCount, 'finish', parsedTool.parameters, parsedTool.explanation)
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, true, summary)
  }
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: true, summary } }
}

/** Returns null when the call isn't a repeated/oscillating action, so the caller proceeds. */
export async function handleLoopDetection(ctx: ResponseInterpreterContext, parsedTool: AgentToolCall): Promise<ResponseInterpretationOutcome | null> {
  const loopCheck = ctx.loopDetector.recordAndCheck(parsedTool)
  if (!loopCheck.isLooping || !loopCheck.suggestedIntervention) return null

  ctx.state.stagnationStreak++
  const loopTarget = parsedTool.parameters?.filePath || parsedTool.parameters?.command || parsedTool.parameters?.url
  const enhancedIntervention = `${loopCheck.suggestedIntervention}\n\n[STAGNATION DIRECTIVE (Attempt ${ctx.state.stagnationStreak})]\nYou have been blocked ${ctx.state.stagnationStreak} times for repeating operations on '${loopTarget || 'target'}'. You are FORBIDDEN from calling ${parsedTool.tool} on '${loopTarget || 'target'}'. You MUST run a verification command via run_command or read a different file to break out of this loop.`

  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: parsedTool.tool,
      target: loopTarget,
      status: 'BLOCKED',
      summary: `Loop / Oscillation Trap Detected (${loopCheck.consecutiveDuplicateCount} repeats, Stagnation: ${ctx.state.stagnationStreak})`,
    },
    enhancedIntervention
  )
  ctx.emitLog(
    'info',
    `⚠️ Loop Prevented: ${parsedTool.tool} ripetuto ${loopCheck.consecutiveDuplicateCount} volte`,
    'Intervento automatico: cambio di strategia inviato al modello.'
  )
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logLoopIntervention(
      ctx.sessionId,
      ctx.stepCount,
      parsedTool.tool,
      loopTarget,
      loopCheck.consecutiveDuplicateCount,
      enhancedIntervention
    )
  }
  if (ctx.isUnlimitedSteps && ctx.state.stagnationStreak >= 15) {
    // A hard stop here means the model never broke out of its loop -- this is the session
    // giving up, not completing the task, so it must never be recorded as a success.
    const stagSummary = `Pausa per stagnazione: raggiunti ${ctx.state.stagnationStreak} step consecutivi senza progresso.`
    ctx.emitLog('info', `⚠️ Circuit Breaker: ${stagSummary}`)
    ctx.emitDone(false, stagSummary)
    await ctx.persistCurrentState()
    ctx.finalizeSession()
    return { outcome: 'return', result: { success: false, summary: stagSummary } }
  }

  ctx.loopDetector.resetTarget(loopTarget)
  return { outcome: 'continue' }
}
