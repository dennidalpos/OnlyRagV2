import type { AgentToolCall } from '../domain/agent/agentTypes'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { isCompletionMilestoneTitle } from '../../../shared/domain/agent/planAndSolveGraph'
import { resolveLoopEscapeAction, resolveRedundantSuccessAction } from '../domain/agent/loopEscapePolicy'
import { abandonedMilestoneNote } from '../domain/agent/milestoneUpdateAuthority'
import { isActiveMilestoneDelivered, resolvePlanDirectiveForTurn } from './agentOrchestratorCircuitBreakerAndVerification'
import type { PlanDirectiveKind } from '../domain/agent/planDirectiveArbiter'
import type { ResponseInterpreterContext, ResponseInterpretationOutcome } from './agentOrchestratorResponseInterpreterTypes'

/** Handles the optional finish signal; the application-owned closure decides the real outcome. */
export async function handleFinishTool(ctx: ResponseInterpreterContext, parsedTool: AgentToolCall): Promise<ResponseInterpretationOutcome> {
  if (ctx.agentMode === 'agent') {
    // Reject only the obviously premature step-1/2 signal. Every other finish reaches the
    // evidence gate, which can return verified, unverifiable or blocked without trusting it.
    const nonFinishPendingMilestones = ctx.goalPlanner.getMilestones().filter(
      (m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m)
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
  }
  const paramSummary = parsedTool.parameters?.summary || parsedTool.parameters?.report || parsedTool.parameters?.finalReport || parsedTool.parameters?.content
  const explanation = parsedTool.explanation
  const summary = (paramSummary && paramSummary.trim().length > 0)
    ? paramSummary.trim()
    : (explanation && explanation.trim().length > 0)
    ? explanation.trim()
    : 'Task completed successfully.'

  if (ctx.agentMode !== 'agent') {
    agentToolExecutorService.commitJournal()
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
    reason: 'Il modello ha segnalato la fine del lavoro; l’applicazione decide l’esito dalle evidenze correnti.',
    modelSummary: summary,
    allowCorrection: true,
  })
  return closure.outcome === 'continue'
    ? { outcome: 'continue' }
    : { outcome: 'return', result: closure.result }
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
  if (!stuckMilestone || isCompletionMilestoneTitle(stuckMilestone)) return null

  ctx.goalPlanner.updateMilestone(
    stuckMilestone.id,
    'failed',
    abandonedMilestoneNote(ctx.state.stagnationStreak, loopTarget || 'target')
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

/**
 * True when an arbitrated directive names the exact call the loop guard blocked.
 *
 * Loose containment, for the same reason isVerificationFailing matches loosely: the model does
 * not always spell the command identically, and a project's check can be reached by more than
 * one spelling.
 */
function commandIsOrderedBy(blockDirective: string | null, loopTarget: string | undefined): boolean {
  if (!blockDirective || !loopTarget) return false
  const needle = loopTarget.trim().toLowerCase()
  return needle.length > 0 && blockDirective.toLowerCase().includes(needle)
}

/**
 * The sentence that introduces an arbitrated directive inside a loop intervention.
 *
 * Each kind gets its own, because the reason repeating is pointless differs: on a verified
 * project nothing further can be added, while on an unverified one the repeat is simply not
 * the action that moves the plan. A shared "stop repeating this" would be true in both and
 * informative in neither.
 */
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
function loopInterventionLogDetail(kind: PlanDirectiveKind): string {
  if (kind === 'session_closure') return 'Progetto già verificato e nulla di aperto da dimostrare: al modello è stato chiesto di chiudere la sessione.'
  if (kind === 'dependencies_undeclared') return 'Il codice importa pacchetti non dichiarati in package.json: al modello è stato chiesto di installarli.'
  if (kind === 'dependencies_missing') return 'Dipendenze dichiarate ma non installate: al modello è stato chiesto di eseguire npm install.'
  if (kind === 'verification_due') return 'Tutti i deliverable sono su disco: al modello è stato chiesto di eseguire il comando di verifica del progetto.'
  return 'Intervento automatico: cambio di strategia inviato al modello.'
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
    ctx.episodicCompactor.lastFailureOutputFor('run_command', 'npm run build')
  )

  // REPLACES the advisory text rather than following it. Appended, it lost: the live
  // eresolve run of 2026-08-24 shows the directive arriving at step 11 correctly, third in a
  // message whose first two blocks read "move to the NEXT unfinished step of your active
  // milestone" and "Advance to the next unfinished step instead". The model did what the
  // first two said and ran another command. One message may carry one instruction.
  //
  // The preamble deliberately says nothing about whether the repeats SUCCEEDED: this text
  // replaces both branches, and the stagnation branch is reached by repeats that failed. In
  // the live run of 2026-08-24 it landed on an `update_plan` rejected twice for having no
  // plan, under a sentence asserting it "succeeded every time".
  // The one case the replacement above did not anticipate: the arbitrated directive ordering the
  // very call that was just blocked. The preamble then asserts "repeating it cannot move the
  // plan" and hands the model, as the single action that can, the repeat itself. There is no
  // move that satisfies both, so the model reissues the call and is blocked again.
  //
  // Measured 2026-08-25T19:59, session live-full-task. `verification_due` fired for the first
  // time in 250 recorded turns — every deliverable was finally on disk — and collided with the
  // guard on its first appearance: steps 44 to 50 were seven blocked `npm run build`s under a
  // directive reading "EVERY DELIVERABLE IS ON DISK — VERIFY THE PROJECT NOW", until the ceiling
  // ended the run.
  //
  // The arbiter is the authority on the single legal move, so when it names the blocked call the
  // block is what gives way. This cannot spin: a check that runs and fails with nothing written
  // after it makes `isVerificationFailing` true, and the arbiter then returns `verification_failing`
  // instead, which orders the opposite. At most one extra run per intervening write.
  if (planDirective.kind === 'verification_due' && commandIsOrderedBy(planDirective.blockDirective, loopTarget)) {
    ctx.emitLog(
      'info',
      `▶️ Loop guard yielded: "${loopTarget}" is the action the plan directive orders (verification_due).`,
      'Bloccarlo avrebbe lasciato il modello senza alcuna mossa eseguibile.',
      { category: 'system_alert' }
    )
    return null
  }

  const arbitratedIntervention = planDirective.blockDirective
    ? `${loopPreambleFor(planDirective.kind, loopTarget, loopCheck.consecutiveDuplicateCount)}

${planDirective.blockDirective}`
    : null
  const isClosure = planDirective.kind === 'session_closure'

  // A repeated COMMAND says nothing about the active milestone. Live run of 2026-08-24, steps
  // 17-18: the model re-ran a failing `npm run build` and the structural escape marked m-1
  // "Create `package.json`" FAILED — a file written correctly at step 1 and on disk
  // throughout. The report then carried "fallita" for work that was done, which is the same
  // damage the closure suspension below already exists to prevent. Unreachable before this
  // wave, because the model never ran a command; reachable now that it does.
  //
  // Narrow on purpose: only when the milestone's own files are all delivered. A milestone
  // still owing a file, or naming none at all, can genuinely deadlock the plan, and the escape
  // keeps its full power there.
  // Extended after run 9 of 2026-08-25, which lost its last milestone to exactly this: m-1
  // `package.json` — written, correct, on disk — was marked FAILED because the model was
  // looping on `src/pages/DashboardPage.tsx`, a file m-1 does not name. The guard covered
  // command loops only, so a loop on somebody else's file still cost a milestone its status.
  // The question is not which tool repeated, it is whether the repeat is about THIS milestone:
  // `isActiveMilestoneDelivered` answers false when the loop target is one of the milestone's
  // own files, so the escape keeps full power exactly where the milestone is the problem.
  const loopIsUnrelatedToActiveMilestone = isActiveMilestoneDelivered(ctx.workspacePath, ctx.goalPlanner, loopTarget)

  // A repeat whose earlier executions SUCCEEDED is redundancy, not stagnation: the deliverable
  // exists. Escalating it would abandon a reachable milestone as FAILED (see
  // resolveRedundantSuccessAction for the audit case). The exemption is bounded — past its
  // advisory budget the repeat rejoins the stagnation ladder so the session still terminates.
  ctx.state.redundantSuccessStreak = loopCheck.repeatOutcome === 'succeeding' ? ctx.state.redundantSuccessStreak + 1 : 0
  const isExemptRedundantSuccess =
    loopCheck.repeatOutcome === 'succeeding' && resolveRedundantSuccessAction(ctx.state.redundantSuccessStreak) === 'advise'

  if (isExemptRedundantSuccess) {
    const redundancyIntervention =
      arbitratedIntervention ||
      `${loopCheck.suggestedIntervention}\n\n[REDUNDANCY DIRECTIVE (Attempt ${ctx.state.redundantSuccessStreak})]\nThis is NOT a failure and it is NOT counted against you: '${loopTarget || 'target'}' already ran successfully. The milestone it belongs to is still achievable — do not abandon it and do not report it as blocked.\nDo not re-issue this identical call: its result is already in your recent tool outputs above. Advance to the next unfinished step instead.`

    ctx.episodicCompactor.recordStep(
      {
        step: ctx.stepCount,
        tool: parsedTool.tool,
        target: loopTarget,
        status: 'BLOCKED',
        summary: `Redundant repeat of a SUCCESSFUL action (${loopCheck.consecutiveDuplicateCount} repeats, Redundancy: ${ctx.state.redundantSuccessStreak})`,
      },
      redundancyIntervention
    )
    ctx.emitLog(
      'info',
      `♻️ Azione ridondante: ${parsedTool.tool} già riuscito, ripetuto ${loopCheck.consecutiveDuplicateCount} volte`,
      arbitratedIntervention
        ? loopInterventionLogDetail(planDirective.kind)
        : 'Nessuna stagnazione conteggiata: il modello è invitato ad avanzare al passo successivo.'
    )
    if (ctx.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logLoopIntervention(
        ctx.sessionId,
        ctx.stepCount,
        parsedTool.tool,
        loopTarget,
        loopCheck.consecutiveDuplicateCount,
        redundancyIntervention
      )
    }
    return { outcome: 'continue' }
  }

  ctx.state.stagnationStreak++
  const isCommand = parsedTool.tool === 'run_command'
  // A build or test command is how the task gets verified at all, so the escape must never
  // read as "stop running it". What is blocked is re-issuing it UNCHANGED, and the way out is
  // to change something first: in session-1787562597025-q8a5 the model was told it was
  // "FORBIDDEN from calling run_command on 'npm run build'" — the exact command the completion
  // gate requires — and spent its remaining turns re-reading files instead of fixing them.
  const escapeDirective = isCommand
    ? `\n[CRITICAL ESCAPE STRATEGY]: Do not re-issue this command unchanged — nothing about the workspace has changed since it last ran. Read the error text in the diagnostics above, apply the fix it names with write_file or replace_file_content, and THEN run the command again. Running a build or test command after a real edit is always allowed and is how this task gets verified. If the command is a scaffolding generator that failed, write the files it would have produced directly instead.`
    : `\n[CRITICAL ESCAPE STRATEGY]: You MUST run a verification command via run_command or read a different file to break out of this loop.`

  const escapeAction = resolveLoopEscapeAction(ctx.state.stagnationStreak, {
    // Never abandon a milestone as FAILED while the project is verified and closable: the
    // remaining milestones are the unprovable ones the closure directive is asking the model
    // to close, and marking them failed would put "fallita" in the final report for work that
    // was done. The streak still climbs, so the abort guarantee at LOOP_ESCAPE_ABORT_STREAK
    // is untouched — only the structural escape is withheld.
    canAdvanceMilestone:
      !isClosure &&
      !loopIsUnrelatedToActiveMilestone &&
      ctx.goalPlanner
        .getMilestones()
        .some((m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m)),
    isUnlimitedSteps: ctx.isUnlimitedSteps,
  })
  const planAdvanceDirective = escapeAction === 'force_milestone_advance' ? forceMilestoneAdvance(ctx, loopTarget) : null

  const enhancedIntervention =
    arbitratedIntervention ||
    `${loopCheck.suggestedIntervention}\n\n[STAGNATION DIRECTIVE (Attempt ${ctx.state.stagnationStreak})]\nYou have been blocked ${ctx.state.stagnationStreak} times for repeating the same operation on '${loopTarget || 'target'}'. What is blocked is the IDENTICAL call, and the block lifts as soon as the situation changes: re-issuing it unchanged will be blocked again, issuing it after a real edit will not.${escapeDirective}${planAdvanceDirective || ''}`

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
    arbitratedIntervention
      ? loopInterventionLogDetail(planDirective.kind)
      : 'Intervento automatico: cambio di strategia inviato al modello.'
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
    const closure = await ctx.closeApplicationRun({
      trigger: 'guard_stop',
      reason: stagSummary,
    })
    return closure.outcome === 'closed'
      ? { outcome: 'return', result: closure.result }
      : { outcome: 'continue' }
  }

  return { outcome: 'continue' }
}
