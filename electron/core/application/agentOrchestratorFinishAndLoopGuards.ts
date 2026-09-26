import path from 'node:path'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { guardForLoopPattern, recordGuardEvent } from '../domain/agent/agentGuardEvents'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { isCompletionMilestoneTitle } from '../../../shared/domain/agent/planAndSolveGraph'
import { abandonedMilestoneNote } from '../domain/agent/milestoneUpdateAuthority'
import { isActiveMilestoneDelivered, resolvePlanDirectiveForTurn } from './agentOrchestratorCircuitBreakerAndVerification'
import type { PlanDirectiveDecision, PlanDirectiveKind } from '../domain/agent/planDirectiveArbiter'
import type { ResponseInterpreterContext, ResponseInterpretationOutcome } from './agentOrchestratorRunContext'
import { emitLocalizedLog } from './agentOrchestratorTypes'
import { renderAdviceSteps } from '../domain/agent/diagnosticAdvice'
import type { AgentLocalizedText } from '../../../shared/domain/agent/agentMainText'

/** Handles the optional finish signal; the application-owned closure decides the real outcome. */
export async function handleFinishTool(ctx: ResponseInterpreterContext, parsedTool: AgentToolCall): Promise<ResponseInterpretationOutcome> {
  if (ctx.agentMode !== 'ask') {
    // Reject only the obviously premature step-1/2 signal. Every other finish reaches the
    // evidence gate, which can return verified, unverifiable or blocked without trusting it.
    const nonFinishPendingMilestones = ctx.goalPlanner
      .getMilestones()
      .filter((m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m))
    const pendingMilestonesCount = nonFinishPendingMilestones.length

    // Critical Early-Finish Defense: If the model tries to finish immediately at step 1 or 2 with 0 file mutations and pending work milestones (>0), and has not executed any mutating tool, block it and force it to take action.
    const isPrematureStart = ctx.stepCount <= 2 && !ctx.flags.hasFileMutations && pendingMilestonesCount > 0
    if (isPrematureStart && !ctx.surfacedDodReasons.has('premature_start')) {
      ctx.surfacedDodReasons.add('premature_start')
      const zeroMutationIntervention = renderAdviceSteps(
        '[CRITICAL EXECUTION ERROR: PREMATURE FINISH WITH ZERO WORK DONE]',
        [
          'You have NOT created or modified any files yet in this workspace (0 files touched).',
          'The "finish" call was refused: the plan still has pending milestones and none of their work exists on disk.',
        ],
        [
          'Begin implementing the first milestone.',
          'Create the necessary project files (e.g. package.json, src/App.tsx, index.html) using "write_file" or scaffold with "run_command".',
          'Invoke "finish" once your implementation is written and verified.',
        ],
      )

      ctx.episodicCompactor.recordStep(
        { step: ctx.stepCount, tool: 'finish', status: 'BLOCKED', summary: 'Premature finish with 0 file mutations on session start' },
        zeroMutationIntervention,
      )
      emitLocalizedLog(ctx.emitLog, 'info', { key: 'dodPrematureFinish' }, zeroMutationIntervention, { category: 'system_alert' })
      if (ctx.settings.enableCodingAgentDebugLog) {
        codingAgentLogger.logToolResult(ctx.sessionId, ctx.stepCount, 'finish', zeroMutationIntervention)
      }
      return { outcome: 'continue' }
    }
  }
  const paramSummary = parsedTool.parameters?.summary || parsedTool.parameters?.report || parsedTool.parameters?.finalReport || parsedTool.parameters?.content
  const explanation = parsedTool.explanation
  const summary =
    paramSummary && paramSummary.trim().length > 0
      ? paramSummary.trim()
      : explanation && explanation.trim().length > 0
        ? explanation.trim()
        : 'Task completed successfully.'

  if (ctx.agentMode === 'ask') {
    agentToolExecutorService.checkpointJournal(ctx.workspacePath, ctx.sessionId)
    ctx.emitLog('info', `Task Finished: ${summary}`, summary, { category: 'final_report' })
    ctx.emitDone(true, summary)
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logToolCall(ctx.sessionId, ctx.stepCount, 'finish', parsedTool.parameters, parsedTool.explanation)
      codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, true, summary)
    }
    await ctx.persistCurrentState('finish')
    ctx.finalizeSession()
    return { outcome: 'return', result: { success: true, summary } }
  }

  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logToolCall(ctx.sessionId, ctx.stepCount, 'finish', parsedTool.parameters, parsedTool.explanation)
  }
  const closure = await ctx.closeApplicationRun({
    trigger: 'finish',
    reason: { key: 'reasonFinish' },
    modelSummary: summary,
    allowCorrection: true,
  })
  return closure.outcome === 'continue' ? { outcome: 'continue' } : { outcome: 'return', result: closure.result }
}

/** Moves the plan's focus off the milestone the model is stuck on and onto the next one, returning the directive that tells the model what changed. */
function forceMilestoneAdvance(ctx: ResponseInterpreterContext, loopTarget: string | undefined, loopTool: string): string | null {
  const stuckMilestone = ctx.goalPlanner.getActiveMilestone()
  if (!stuckMilestone || isCompletionMilestoneTitle(stuckMilestone)) return null

  const loopBlocks = ctx.state.progress.consecutiveLoopBlocks
  ctx.goalPlanner.updateMilestone(stuckMilestone.id, 'failed', abandonedMilestoneNote(loopBlocks, loopTarget || loopTool))

  // The next milestone may legitimately need to touch the same file the model was just
  // blocked on, so the detector's memory of that target is cleared along with the focus.
  ctx.loopDetector.resetTarget(loopTarget)

  const nextMilestone = ctx.goalPlanner.getActiveMilestone()
  emitLocalizedLog(
    ctx.emitLog,
    'info',
    { key: 'milestoneAbandoned', params: { id: stuckMilestone.id, blocks: loopBlocks } },
    nextMilestone ? { key: 'milestoneNextActive', params: { id: nextMilestone.id, title: nextMilestone.title } } : { key: 'milestoneNoneLeft' },
    { category: 'system_alert' },
  )

  return nextMilestone
    ? `\n\n[PLAN ADVANCED BY THE SYSTEM]\nMilestone "${stuckMilestone.id}: ${stuckMilestone.title}" has been marked FAILED and ABANDONED — stop working on it entirely.\nYour active milestone is now "${nextMilestone.id}: ${nextMilestone.title}". Execute THAT milestone in your next tool call.`
    : `\n\n[PLAN ADVANCED BY THE SYSTEM]\nMilestone "${stuckMilestone.id}: ${stuckMilestone.title}" has been marked FAILED and ABANDONED. No operational milestones remain: invoke the "finish" tool now with a full final report describing what was and was not completed.`
}

/** True when an arbitrated directive names the exact call the loop guard blocked. */
function commandIsOrderedBy(blockDirective: string | null, loopTarget: string | undefined): boolean {
  if (!blockDirective || !loopTarget) return false
  const needle = loopTarget.trim().toLowerCase()
  return needle.length > 0 && blockDirective.toLowerCase().includes(needle)
}

const FILE_EDIT_TOOLS = new Set(['write_file', 'replace_file_content', 'multi_replace_file_content'])

/** True when an arbitrated directive orders a rewrite of exactly the file the loop guard blocked. */
function writeIsOrderedBy(decision: PlanDirectiveDecision, tool: string, loopTarget: string | undefined, workspacePath: string | null | undefined): boolean {
  if (!loopTarget || !FILE_EDIT_TOOLS.has(tool)) return false
  const relativeTarget = workspacePath && path.isAbsolute(loopTarget) ? path.relative(workspacePath, loopTarget) : loopTarget
  const normalize = (filePath: string) => filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
  return (decision.rewriteTargets ?? []).some((target) => normalize(target) === normalize(relativeTarget))
}

/** The sentence that introduces an arbitrated directive inside a loop intervention. */
function loopPreambleFor(kind: PlanDirectiveKind, loopTarget: string | undefined, repeats: number): string {
  const target = loopTarget || 'this action'
  if (kind === 'session_closure') {
    return `[SESSION COMPLETE — STOP REPEATING '${target}']
You have re-issued this call ${repeats} times. Whether it succeeds or fails no longer changes anything: the project's verification has already passed and nothing you run now can add to it.`
  }
  return `[STOP REPEATING '${target}' — ONE ACTION MOVES THIS PLAN]
You have re-issued this call ${repeats} times and the plan has not moved. Repeating it cannot move it. The single action that can is below; execute exactly that.`
}

/** What the USER is told about an intervention the arbiter decided. */
function loopInterventionLogDetail(kind: PlanDirectiveKind): AgentLocalizedText {
  if (kind === 'session_closure') return { key: 'loopDetailSessionClosure' }
  if (kind === 'dependencies_undeclared') return { key: 'loopDetailDependenciesUndeclared' }
  if (kind === 'dependencies_missing') return { key: 'loopDetailDependenciesMissing' }
  if (kind === 'verification_due') return { key: 'loopDetailVerificationDue' }
  return { key: 'loopDetailStrategyChange' }
}

/** Returns null when the call isn't a repeated/oscillating action, so the caller proceeds. */
export async function handleLoopDetection(ctx: ResponseInterpreterContext, parsedTool: AgentToolCall): Promise<ResponseInterpretationOutcome | null> {
  const loopCheck = ctx.loopDetector.recordAndCheck(parsedTool)
  if (!loopCheck.isLooping || !loopCheck.suggestedIntervention) return null

  const loopTarget = parsedTool.parameters?.filePath || parsedTool.parameters?.command || parsedTool.parameters?.url

  // Keep loop advice aligned with the single directive selected by the arbiter.
  const planDirective = resolvePlanDirectiveForTurn(
    ctx.workspacePath,
    ctx.goalPlanner,
    ctx.flags.hasVerifiedBuild,
    ctx.episodicCompactor.getEpisodes(),
    (command) => ctx.episodicCompactor.lastFailureOutputFor('run_command', command),
    ctx.episodicCompactor.getRecentFullLogs(),
    ctx.settings.capabilityPolicyMode,
  )

  // Replace advisory text with single clear directive to avoid conflicting instructions.
  // If arbiter ordered the blocked command (e.g. verification_due), yield to let verification run.
  // A write to the file the directive orders rewritten yields too, unless it repeats an earlier call
  // unchanged: the same-file edit count blocked the ordered package.json fix for 10 steps once the
  // model finally wrote it (live full task run of 2026-09-25, steps 40-49).
  const orderedCommand = planDirective.kind === 'verification_due' && commandIsOrderedBy(planDirective.blockDirective, loopTarget)
  const orderedWrite = loopCheck.pattern !== 'exact_repeat' && writeIsOrderedBy(planDirective, parsedTool.tool, loopTarget, ctx.workspacePath)
  if (orderedCommand || orderedWrite) {
    emitLocalizedLog(
      ctx.emitLog,
      'info',
      { key: 'loopGuardYielded', params: { target: String(loopTarget), kind: planDirective.kind } },
      { key: 'loopGuardYieldedDetail' },
      { category: 'system_alert' },
    )
    return null
  }

  const arbitratedIntervention = planDirective.blockDirective
    ? `${loopPreambleFor(planDirective.kind, loopTarget, loopCheck.consecutiveDuplicateCount)}

${planDirective.blockDirective}`
    : null
  const isClosure = planDirective.kind === 'session_closure'

  // Do not mark active milestone FAILED if its deliverables are already satisfied on disk.
  const loopIsUnrelatedToActiveMilestone = isActiveMilestoneDelivered(ctx.workspacePath, ctx.goalPlanner, loopTarget)

  // A repeat of a successful action is redundancy, not stagnation.
  const canAdvanceMilestone =
    !isClosure &&
    !loopIsUnrelatedToActiveMilestone &&
    ctx.goalPlanner.getMilestones().some((m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m))
  const loopDecision = ctx.state.progress.onLoopBlock(loopCheck.repeatOutcome, { canAdvanceMilestone, isUnlimitedSteps: ctx.isUnlimitedSteps })

  if (loopDecision.kind === 'redundant') {
    recordGuardEvent(ctx.state.guardEvents, 'redundant_success', 'advise', ctx.stepCount)
    const redundancyIntervention =
      arbitratedIntervention ||
      `${loopCheck.suggestedIntervention}\n\n[REDUNDANCY NOTE (Attempt ${loopDecision.redundantBlocks})]\nThis is NOT a failure and it is NOT counted against you: '${loopTarget || 'target'}' already ran successfully. The milestone it belongs to is still achievable — do not abandon it and do not report it as blocked.\nDo not re-issue this identical call: its result is already in your recent tool outputs above. Advance to the next unfinished step instead.`

    ctx.episodicCompactor.recordStep(
      {
        step: ctx.stepCount,
        tool: parsedTool.tool,
        target: loopTarget,
        status: 'BLOCKED',
        summary: `Redundant repeat of a SUCCESSFUL action (${loopCheck.consecutiveDuplicateCount} repeats, Redundancy: ${loopDecision.redundantBlocks})`,
      },
      redundancyIntervention,
    )
    emitLocalizedLog(
      ctx.emitLog,
      'info',
      { key: 'redundantAction', params: { tool: parsedTool.tool, count: loopCheck.consecutiveDuplicateCount } },
      arbitratedIntervention ? loopInterventionLogDetail(planDirective.kind) : { key: 'redundantNoStagnation' },
    )
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logLoopIntervention(
        ctx.sessionId,
        ctx.stepCount,
        parsedTool.tool,
        loopTarget,
        loopCheck.consecutiveDuplicateCount,
        redundancyIntervention,
      )
    }
    return { outcome: 'continue' }
  }

  const loopBlocks = loopDecision.loopBlocks
  const isCommand = parsedTool.tool === 'run_command'
  // A build or test command is how the task gets verified at all, so the escape must never read as "stop running it".
  const escapeDirective = isCommand
    ? `\n[CRITICAL ESCAPE STRATEGY]: Do not re-issue this command unchanged — nothing about the workspace has changed since it last ran. Read the error text in the diagnostics above, apply the fix it names with write_file or replace_file_content, and THEN run the command again. Running a build or test command after a real edit is always allowed and is how this task gets verified. If the command is a scaffolding generator that failed, write the files it would have produced directly instead.`
    : `\n[CRITICAL ESCAPE STRATEGY]: Run a verification command via run_command or read a different file: either breaks this loop.`

  const escapeAction = loopDecision.escape
  const planAdvanceDirective = escapeAction === 'force_milestone_advance' ? forceMilestoneAdvance(ctx, loopTarget, parsedTool.tool) : null
  const loopGuard = guardForLoopPattern(loopCheck.pattern)
  recordGuardEvent(ctx.state.guardEvents, loopGuard, 'advise', ctx.stepCount)
  if (planAdvanceDirective) recordGuardEvent(ctx.state.guardEvents, loopGuard, 'force_advance', ctx.stepCount)

  const enhancedIntervention =
    arbitratedIntervention ||
    `${loopCheck.suggestedIntervention}\n\n[STAGNATION NOTE (Attempt ${loopBlocks})]\nYou have been blocked ${loopBlocks} times for repeating the same operation on '${loopTarget || 'target'}'. What is blocked is the IDENTICAL call, and the block lifts as soon as the situation changes: re-issuing it unchanged will be blocked again, issuing it after a real edit will not.${escapeDirective}${planAdvanceDirective || ''}`

  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: parsedTool.tool,
      target: loopTarget,
      status: 'BLOCKED',
      summary: `Loop / Oscillation Trap Detected (${loopCheck.consecutiveDuplicateCount} repeats, Stagnation: ${loopBlocks})`,
    },
    enhancedIntervention,
  )
  emitLocalizedLog(
    ctx.emitLog,
    'info',
    { key: 'loopPrevented', params: { tool: parsedTool.tool, count: loopCheck.consecutiveDuplicateCount } },
    loopInterventionLogDetail(arbitratedIntervention ? planDirective.kind : 'focus'),
  )
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logLoopIntervention(ctx.sessionId, ctx.stepCount, parsedTool.tool, loopTarget, loopCheck.consecutiveDuplicateCount, enhancedIntervention)
  }
  if (escapeAction === 'abort') {
    // A hard stop here means the model never broke out of its loop -- this is the session
    // giving up, not completing the task, so it must never be recorded as a success.
    const stagnation: AgentLocalizedText = { key: 'reasonStagnation', params: { steps: loopBlocks } }
    emitLocalizedLog(ctx.emitLog, 'info', { key: 'circuitBreaker', params: { reason: stagnation } })
    const closure = await ctx.closeApplicationRun({
      trigger: 'guard_stop',
      guard: 'stagnation_abort',
      reason: stagnation,
    })
    return closure.outcome === 'closed' ? { outcome: 'return', result: closure.result } : { outcome: 'continue' }
  }

  return { outcome: 'continue' }
}
