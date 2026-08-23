import type { AgentToolCall } from '../domain/agent/agentTypes'
import { agentToolExecutorService } from './agentToolExecutorService'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { isCompletionMilestoneTitle } from '../domain/agent/planAndSolveGraph'
import { resolveLoopEscapeAction } from '../domain/agent/loopEscapePolicy'
import type { ResponseInterpreterContext, ResponseInterpretationOutcome } from './agentOrchestratorResponseInterpreterTypes'

/**
 * Definition of Done (DoD) Execution Guard Gate. Each distinct violation reason intercepts
 * finish AT MOST ONCE (tracked in surfacedDodReasons): the guard's job is to make the model
 * aware of the missing verification, not to deadlock the session when milestone statuses
 * can't advance (milestone progression is still heuristic).
 */
export async function handleFinishTool(ctx: ResponseInterpreterContext, parsedTool: AgentToolCall): Promise<ResponseInterpretationOutcome> {
  if (ctx.agentMode === 'agent') {
    // `failed` milestones are abandoned work, not outstanding work: the loop guard gave up on
    // them deliberately and the plan block already orders the model to report them as
    // incomplete. Counting them as pending made this gate demand "update milestone statuses to
    // verified" for milestones that can never reach verified, contradicting that same order.
    // The build requirement below is untouched — that is the gate that actually protects quality.
    const nonFinishPendingMilestones = ctx.goalPlanner.getMilestones().filter(
      (m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m.title)
    )
    const pendingMilestonesCount = nonFinishPendingMilestones.length

    // Critical Early-Finish Defense:
    // If the model tries to finish immediately at step 1 or 2 with 0 file mutations and pending work milestones (>0),
    // and has not executed any mutating tool, block it and force it to take action.
    const isPrematureStart = ctx.stepCount <= 2 && !ctx.flags.hasFileMutations && pendingMilestonesCount > 0
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

  // Mark completion / finish milestones as verified when finish tool is executed successfully
  for (const m of ctx.goalPlanner.getMilestones()) {
    if (isCompletionMilestoneTitle(m.title) && m.status !== 'failed') {
      ctx.goalPlanner.updateMilestone(m.id, 'verified')
    }
  }

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

/**
 * Moves the plan's focus off the milestone the model is stuck on and onto the next one,
 * returning the directive that tells the model what changed.
 *
 * The milestone is recorded as `failed`, not `verified`: the work genuinely did not happen,
 * and progress percentages, the session tracker and the Definition of Done gate must all keep
 * saying so. `getActiveMilestone` skips failed entries, so the very next prompt asks for a
 * different deliverable — which is the whole point, since re-issuing the same ACTIVE MILESTONE
 * line is what kept the model re-emitting the blocked tool call.
 */
function forceMilestoneAdvance(ctx: ResponseInterpreterContext, loopTarget: string | undefined): string | null {
  const stuckMilestone = ctx.goalPlanner.getActiveMilestone()
  if (!stuckMilestone || isCompletionMilestoneTitle(stuckMilestone.title)) return null

  ctx.goalPlanner.updateMilestone(
    stuckMilestone.id,
    'failed',
    `Abandoned after ${ctx.state.stagnationStreak} consecutive blocked attempts on '${loopTarget || 'target'}'.`
  )

  // The next milestone may legitimately need to touch the same file the model was just
  // blocked on, so the detector's memory of that target is cleared along with the focus.
  ctx.loopDetector.resetTarget(loopTarget)

  const nextMilestone = ctx.goalPlanner.getActiveMilestone()
  ctx.emitLog(
    'info',
    `⏭️ Escape strutturale: milestone ${stuckMilestone.id} abbandonata dopo ${ctx.state.stagnationStreak} blocchi consecutivi.`,
    nextMilestone ? `Nuova milestone attiva: ${nextMilestone.id}: ${nextMilestone.title}` : 'Nessuna milestone operativa rimasta.',
    { category: 'system_alert' }
  )

  return nextMilestone
    ? `\n\n[PLAN ADVANCED BY THE SYSTEM]\nMilestone "${stuckMilestone.id}: ${stuckMilestone.title}" has been marked FAILED and ABANDONED — stop working on it entirely.\nYour active milestone is now "${nextMilestone.id}: ${nextMilestone.title}". Execute THAT milestone in your next tool call.`
    : `\n\n[PLAN ADVANCED BY THE SYSTEM]\nMilestone "${stuckMilestone.id}: ${stuckMilestone.title}" has been marked FAILED and ABANDONED. No operational milestones remain: invoke the "finish" tool now with a full final report describing what was and was not completed.`
}

/** Returns null when the call isn't a repeated/oscillating action, so the caller proceeds. */
export async function handleLoopDetection(ctx: ResponseInterpreterContext, parsedTool: AgentToolCall): Promise<ResponseInterpretationOutcome | null> {
  const loopCheck = ctx.loopDetector.recordAndCheck(parsedTool)
  if (!loopCheck.isLooping || !loopCheck.suggestedIntervention) return null

  ctx.state.stagnationStreak++
  const loopTarget = parsedTool.parameters?.filePath || parsedTool.parameters?.command || parsedTool.parameters?.url
  const isCommand = parsedTool.tool === 'run_command'
  const escapeDirective = isCommand
    ? `\n[CRITICAL ESCAPE STRATEGY]: If a scaffolding or build command failed or is blocked, DO NOT repeat it. Instead, switch IMMEDIATELY to constructing or editing the required files directly with write_file (e.g. write package.json, vite.config.ts, src/App.tsx), or run a read/verification tool.`
    : `\n[CRITICAL ESCAPE STRATEGY]: You MUST run a verification command via run_command or read a different file to break out of this loop.`

  const escapeAction = resolveLoopEscapeAction(ctx.state.stagnationStreak, {
    canAdvanceMilestone: ctx.goalPlanner
      .getMilestones()
      .some((m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m.title)),
    isUnlimitedSteps: ctx.isUnlimitedSteps,
  })
  const planAdvanceDirective = escapeAction === 'force_milestone_advance' ? forceMilestoneAdvance(ctx, loopTarget) : null

  const enhancedIntervention = `${loopCheck.suggestedIntervention}\n\n[STAGNATION DIRECTIVE (Attempt ${ctx.state.stagnationStreak})]\nYou have been blocked ${ctx.state.stagnationStreak} times for repeating operations on '${loopTarget || 'target'}'. You are FORBIDDEN from calling ${parsedTool.tool} on '${loopTarget || 'target'}'.${escapeDirective}${planAdvanceDirective || ''}`

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
  if (escapeAction === 'abort') {
    // A hard stop here means the model never broke out of its loop -- this is the session
    // giving up, not completing the task, so it must never be recorded as a success.
    const stagSummary = `Pausa per stagnazione: raggiunti ${ctx.state.stagnationStreak} step consecutivi senza progresso.`
    ctx.emitLog('info', `⚠️ Circuit Breaker: ${stagSummary}`)
    // Without this the audit log simply stopped mid-session with no outcome recorded, which
    // is exactly how session-1787476734227-nkn0 ended -- 38 steps and no way to tell from the
    // log whether it finished, crashed or gave up.
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, false, stagSummary)
    }
    ctx.emitDone(false, stagSummary)
    await ctx.persistCurrentState()
    ctx.finalizeSession()
    return { outcome: 'return', result: { success: false, summary: stagSummary } }
  }

  return { outcome: 'continue' }
}
