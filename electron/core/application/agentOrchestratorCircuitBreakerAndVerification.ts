import path from 'node:path'
import { resolveMilestoneDeliverableStatus } from '../domain/agent/milestoneDeliverableResolver'
import { createWorkspaceDeliverableProbe } from '../infrastructure/filesystem/workspaceDeliverableProbe'
import { scanCommandTouchedFiles } from '../infrastructure/filesystem/commandTouchedFilesScanner'
import { isCompletionMilestoneTitle } from '../domain/agent/planAndSolveGraph'
import type { ToolResultProcessingContext, ToolResultProcessingOutcome } from './agentOrchestratorToolResultTypes'

/** Returns a `return` outcome if the stagnation circuit breaker trips into a hard stop. */
export async function runCircuitBreaker(
  ctx: ToolResultProcessingContext,
  isMutating: boolean,
  isToolFailure: boolean
): Promise<ToolResultProcessingOutcome | null> {
  const cbRes = ctx.circuitBreaker.recordStep(isMutating, isToolFailure)
  if (!cbRes.shouldBreak) return null

  // The circuit breaker is forcing a pause/intervention due to stagnation/looping
  const cbMsg = `⚠️ Circuit Breaker Triggered: ${cbRes.reason}`
  ctx.emitLog('info', cbMsg)
  ctx.emitDone(false, cbRes.suggestedAction || cbMsg)
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: false, summary: cbRes.suggestedAction || cbMsg } }
}

/**
 * Advances the active milestone when the file mutation that just landed satisfies it.
 *
 * Without this, a milestone whose deliverable is a file has no route to `verified` at all
 * (trackVerification only reacts to run_tests / open_in_browser / build commands), so the
 * plan froze on its first entry for every model that does not volunteer `update_plan` —
 * and the prompt then re-issued that same milestone until the session died of stagnation.
 *
 * Two cases advance, and both leave a note saying which rule fired:
 *  - `satisfied`      — every path named in the title is on disk with content.
 *  - `not_applicable` — the title names no artefact at all ("design the tablet layout").
 *    Nothing can ever falsify such a milestone, so gating progress on it is pure deadlock;
 *    one successful mutation while it is active is taken as the work having happened.
 *
 * Advancing here does NOT weaken the Definition of Done: handleFinishTool still refuses to
 * close a session that has never produced a passing build (verifyBeforeFinish).
 */
function advanceActiveMilestoneOnMutation(ctx: ToolResultProcessingContext) {
  const activeM = ctx.goalPlanner.getActiveMilestone()
  if (!activeM || activeM.status === 'verified') return

  // The closing milestone is owned by handleFinishTool — it must never be pre-verified here,
  // or the plan would read 100% complete before the agent has written its final report.
  if (isCompletionMilestoneTitle(activeM.title)) return

  if (!ctx.workspacePath) {
    if (activeM.status === 'pending') ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress')
    return
  }

  const probe = createWorkspaceDeliverableProbe(ctx.workspacePath)
  const deliverableStatus = resolveMilestoneDeliverableStatus(activeM.title, probe)

  if (deliverableStatus === 'satisfied') {
    ctx.goalPlanner.updateMilestone(activeM.id, 'verified', 'Auto-verified: every file named by this milestone exists on disk with content.')
    ctx.emitLog('info', `✅ Milestone ${activeM.id} verificata: i file richiesti sono presenti nel workspace.`)
    return
  }

  if (deliverableStatus === 'not_applicable') {
    ctx.goalPlanner.updateMilestone(activeM.id, 'verified', 'Auto-verified: milestone names no file artefact, advanced on a successful file mutation.')
    ctx.emitLog('info', `➡️ Milestone ${activeM.id} avanzata: nessun artefatto verificabile dichiarato nel titolo.`)
    return
  }

  if (activeM.status === 'pending') {
    ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress')
  }
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
  }

  advanceActiveMilestoneOnMutation(ctx)
}

/**
 * Registers the files a successful shell command created or rewrote.
 *
 * Only the write_file / replace / delete tools emit `changeStats`, so a project scaffolded by
 * a CLI left `sessionChangedFiles` empty — SESSION_TRACKER.md then reported "Modified &
 * Created Files: None" after a scaffold that had in fact written the whole project, and the
 * Definition of Done gate still believed nothing had been produced.
 *
 * Keys match the absolute-path convention `changeStats` already uses, so a file written first
 * by a command and later by write_file stays a single entry. Line counts stay at zero: the
 * scan attributes files by mtime and never reads their contents, so it has no diff to report.
 */
export function recordCommandTouchedFiles(ctx: ToolResultProcessingContext) {
  if (ctx.parsedTool.tool !== 'run_command' || !ctx.workspacePath) return

  const scan = scanCommandTouchedFiles(ctx.workspacePath, ctx.toolStartedAtMs)
  if (scan.files.length === 0) return

  let newlyTracked = 0
  for (const relativePath of scan.files) {
    const absolutePath = path.join(ctx.workspacePath, relativePath)
    if (ctx.sessionChangedFiles.has(absolutePath)) continue
    ctx.sessionChangedFiles.set(absolutePath, { additions: 0, deletions: 0 })
    newlyTracked++
  }

  ctx.flags.hasFileMutations = true
  if (newlyTracked > 0) {
    ctx.emitLog(
      'info',
      `📂 ${newlyTracked} file tracciati dal comando eseguito${scan.truncated ? ' (scansione troncata: workspace molto grande)' : ''}.`
    )
  }

  advanceActiveMilestoneOnMutation(ctx)
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
