import { ResilientModelDispatcher } from './resilientModelDispatcher'
import type { ToolResultProcessingContext, ToolResultProcessingOutcome } from './agentOrchestratorToolResultTypes'

/** Returns a `return` outcome if the stagnation circuit breaker trips into a hard stop. */
export async function runCircuitBreaker(
  ctx: ToolResultProcessingContext,
  isMutating: boolean,
  isToolFailure: boolean
): Promise<ToolResultProcessingOutcome | null> {
  const cbRes = ctx.circuitBreaker.recordStep(isMutating, isToolFailure)
  if (!cbRes.shouldBreak) return null

  const escalation = ResilientModelDispatcher.getNextEscalationModel(ctx.targetModel, {
    fastModel: ctx.fallbackModel,
    standardModel: ctx.intermediateModel,
    deepReasoningModel: ctx.settings.complexityDeepModel || ctx.intermediateModel,
    heavyEscalationModel: ctx.heavyEscalationModel,
  })

  if (escalation && escalation.nextModel !== ctx.targetModel) {
    ctx.emitLog(
      'info',
      `🔺 Circuit Breaker Escalation (${cbRes.reason}): Evicting VRAM & switching model ${ctx.targetModel} → ${escalation.nextModel} [${escalation.tierLabel}]`
    )
    await ResilientModelDispatcher.evictVram(['*'], ctx.settings.ollamaHost)
    ctx.flags.currentOverriddenModel = escalation.nextModel
    ctx.circuitBreaker.reset()
    return null
  }

  if (!ctx.isUnlimitedSteps) return null

  // No escalation model left to try: the breaker is forcing a hard pause, which means the task
  // did not complete -- must never be reported as a success.
  const cbMsg = `⚠️ Circuit Breaker Triggered: ${cbRes.reason}`
  ctx.emitLog('info', cbMsg)
  ctx.emitDone(false, cbRes.suggestedAction || cbMsg)
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: false, summary: cbRes.suggestedAction || cbMsg } }
}

export async function recordMutationSideEffects(ctx: ToolResultProcessingContext, targetParam: string | undefined) {
  ctx.flags.hasFileMutations = true
  // Checkpoint immediately after a successful file mutation, independent of the periodic
  // PERSIST_EVERY_N_STEPS cadence, so a crash right after a write never loses track of what
  // was actually changed on disk.
  await ctx.persistCurrentState()
  if (targetParam) {
    const snap = ctx.executionGuard.captureWorkspaceSnapshot([targetParam])
    const stagCheck = ctx.executionGuard.detectStateStagnation(snap)
    if (!stagCheck.allowed && stagCheck.suggestedAction) {
      ctx.episodicCompactor.recordStep(
        { step: ctx.stepCount, tool: ctx.parsedTool.tool, status: 'BLOCKED', summary: stagCheck.reason || 'State Stagnation' },
        stagCheck.suggestedAction
      )
      ctx.emitLog('info', `⚡ ExecutionGuard: ${stagCheck.reason}`)
    }

    // Auto-advance scaffolding/setup milestone when core configuration files are created
    if (/(package\.json|tsconfig\.json|vite\.config|requirements\.txt|pyproject\.toml)$/i.test(targetParam)) {
      const activeM = ctx.goalPlanner.getActiveMilestone()
      if (activeM && /scaffold|setup|inizializz|configura|dipendenze/i.test(activeM.title)) {
        ctx.goalPlanner.updateMilestone(activeM.id, 'verified', 'Auto-verified by project configuration setup.')
      }
    }
  }
  const activeM = ctx.goalPlanner.getActiveMilestone()
  if (activeM && activeM.status === 'pending') {
    ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress')
  }
}

/**
 * Milestone auto-verification is driven by run_tests, open_in_browser, and successful build/test commands.
 */
export function trackVerification(ctx: ToolResultProcessingContext, isToolFailure: boolean) {
  if (ctx.toolRes.verification?.ran) {
    const activeM = ctx.goalPlanner.getActiveMilestone()
    if (ctx.toolRes.verification.passed) {
      ctx.flags.hasVerifiedBuild = true
      if (activeM) ctx.goalPlanner.updateMilestone(activeM.id, 'verified', 'Auto-verified by a passing run_tests execution.')
    } else if (activeM) {
      ctx.goalPlanner.updateMilestone(activeM.id, 'failed', 'run_tests reported failures.')
    }
    return
  }

  if (ctx.parsedTool.tool === 'open_in_browser' && !isToolFailure) {
    ctx.flags.hasVerifiedBuild = true
    const activeM = ctx.goalPlanner.getActiveMilestone()
    if (activeM && activeM.status !== 'verified') {
      ctx.goalPlanner.updateMilestone(activeM.id, 'verified', 'Verified by launching browser preview.')
    }
    return
  }

  if (ctx.parsedTool.tool !== 'run_command') return

  // A successful build/typecheck/lint satisfies the Definition of Done gate and advances verification milestones
  const cmdStr = (ctx.parsedTool.parameters?.command || '').toLowerCase()
  const isVerificationCmd = ['test', 'typecheck', 'build', 'lint', 'pytest', 'tsc'].some((kw) => cmdStr.includes(kw))
  if (isVerificationCmd && !ctx.toolRes.outputForHistory.includes('[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]') && !isToolFailure) {
    ctx.flags.hasVerifiedBuild = true
    const activeM = ctx.goalPlanner.getActiveMilestone()
    if (activeM && /verifi|test|build|check|collaudo|validaz/i.test(activeM.title)) {
      ctx.goalPlanner.updateMilestone(activeM.id, 'verified', 'Auto-verified by successful build/verification command execution.')
    }
  }
}
