import path from 'node:path'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { resolveMilestoneDeliverableStatus, isDeliverableOfMilestone } from '../domain/agent/milestoneDeliverableResolver'
import { createWorkspaceDeliverableProbe } from '../infrastructure/filesystem/workspaceDeliverableProbe'
import {
  awaitingVerificationNote,
  promotionNote,
  selectMilestonesProvenByVerification,
} from '../domain/agent/milestoneVerificationPromotion'
import { scanCommandTouchedFiles } from '../infrastructure/filesystem/commandTouchedFilesScanner'
import { isCompletionMilestoneTitle } from '../domain/agent/planAndSolveGraph'
import { isBrowserRenderableTarget } from '../domain/agent/browserPreviewVerification'
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
  // Every session-ending path must leave an outcome in the audit log; this one and the
  // stagnation abort in handleLoopDetection were the two that did not.
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, false, cbRes.suggestedAction || cbMsg)
  }
  ctx.emitDone(false, cbRes.suggestedAction || cbMsg)
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: false, summary: cbRes.suggestedAction || cbMsg } }
}

/**
 * Advances the active milestone when the file mutation that just landed is evidence for it.
 *
 * A milestone closes here on exactly one condition: the file just written is one the
 * milestone itself set out to produce, AND every file it names is now on disk with content.
 * Both halves matter. Without the first, a run writing `src/App.tsx` closed whichever
 * milestone happened to be active — and without the second, a partially delivered milestone
 * would close on its first file.
 *
 * A milestone naming no artefact at all ("ensure buttons have a 44x44 touch target", "run
 * the application") is NEVER closed here. It used to be, on the reasoning that nothing could
 * falsify it so gating on it was deadlock — but that manufactured verification rather than
 * granting it: in session-1787476734227-nkn0 the plan reported "Run the application to ensure
 * it is fully runnable" as verified, at 13/15 overall, while the model was still writing
 * src/App.tsx and the project had no entrypoint at all. Such milestones now close only
 * through real evidence — a passing verification command, or an explicit `update_plan` the
 * workspace does not contradict — and the loop guard's structural escape, not a fabricated
 * pass, is what keeps them from deadlocking the plan.
 */
function advanceActiveMilestoneOnMutation(ctx: ToolResultProcessingContext, mutatedPaths: Array<string | undefined>) {
  const activeM = ctx.goalPlanner.getActiveMilestone()
  if (!activeM || activeM.status === 'verified') return

  // The closing milestone is owned by handleFinishTool — it must never be pre-verified here,
  // or the plan would read 100% complete before the agent has written its final report.
  if (isCompletionMilestoneTitle(activeM.title)) return

  const markInProgress = () => {
    if (activeM.status === 'pending') ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress')
  }

  const workspacePath = ctx.workspacePath
  if (!workspacePath) {
    markInProgress()
    return
  }

  const evidencePath = mutatedPaths.find((candidate) => isDeliverableOfMilestone(activeM.title, candidate))
  if (!evidencePath) {
    markInProgress()
    return
  }

  const probe = createWorkspaceDeliverableProbe(workspacePath)
  if (resolveMilestoneDeliverableStatus(activeM.title, probe) !== 'satisfied') {
    markInProgress()
    return
  }

  // Deliberately NOT 'verified'. The file being on disk says it was written, never that it
  // works: see milestoneVerificationPromotion.ts. A passing verification command promotes it.
  ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress', awaitingVerificationNote(evidencePath))
  ctx.emitLog(
    'info',
    `✏️ Milestone ${activeM.id}: scritto "${evidencePath}", tutti i file richiesti sono presenti. In attesa di una verifica che passi.`
  )
}

/**
 * A file written after the last passing build makes that build stale evidence.
 *
 * `hasVerifiedBuild` used to be monotonic: once any build/test/typecheck passed it stayed true
 * for the rest of the session, so the Definition of Done gate accepted a build from step 10 as
 * proof for files written at step 30. Clearing it on every mutation ties the gate to the code
 * that actually exists at finish time.
 *
 * Safe against a verification command invalidating itself: `trackVerification` runs after both
 * callers of this within the same tool result, so a build that writes to `dist/` re-raises the
 * flag in the same step it cleared it.
 */
function invalidateVerifiedBuild(ctx: ToolResultProcessingContext) {
  ctx.flags.hasVerifiedBuild = false
}

export async function recordMutationSideEffects(ctx: ToolResultProcessingContext, targetParam: string | undefined) {
  ctx.flags.hasFileMutations = true
  invalidateVerifiedBuild(ctx)
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

  advanceActiveMilestoneOnMutation(ctx, [targetParam])
}

/**
 * Reports a nested project directory a shell command left in the workspace root.
 *
 * The workspace root IS the project root, but a generator handed a project name creates a
 * subdirectory and puts everything inside it. That rule was written only into the PLANNER
 * prompt, which the agent that actually runs commands never sees, so nothing stopped step 1
 * of session-1787476734227-nkn0 from running `npx create-react-app project-dashboard-task`.
 * It created `test_app/project-dashboard-task`, failed mid-install, and cleaned up only
 * partially — the most likely source of the directories the user could not open afterwards.
 *
 * The directory is reported, never deleted: removing a directory the agent did not ask to
 * remove is not a decision this guard gets to make silently.
 */
function reportNestedProjectDirs(ctx: ToolResultProcessingContext, createdDirs: string[], commandFailed: boolean) {
  if (createdDirs.length === 0) return

  const dirList = createdDirs.map((d) => `"${d}"`).join(', ')
  const directive = commandFailed
    ? `[FAILED COMMAND LEFT DIRECTORIES BEHIND]\nThe command failed, but it created ${dirList} in the workspace root and did not fully remove them. A partially written directory tree can be locked or unreadable.\nDirectives:\n1. Inspect ${dirList} with list_dir and delete what the failed command left behind before retrying anything.\n2. Do NOT re-run the same generator. Build the project files directly at the workspace root with write_file.`
    : `[PROJECT CREATED IN THE WRONG PLACE]\nThe command created ${dirList} inside the workspace root. The workspace root IS the project root — the project must NOT live in a nested subfolder.\nDirectives:\n1. Move the generated files up to the workspace root, or recreate them there directly with write_file.\n2. Delete the nested directory once its contents are at the root.\n3. Never pass a project name to a generator: scaffold in place.`

  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: ctx.parsedTool.tool,
      target: createdDirs[0],
      status: 'BLOCKED',
      summary: commandFailed
        ? `Failed command left ${createdDirs.length} directory(ies) in the workspace root`
        : `Command created ${createdDirs.length} nested project directory(ies) in the workspace root`,
    },
    directive
  )
  ctx.emitLog(
    'info',
    commandFailed
      ? `🧹 Il comando fallito ha lasciato ${dirList} nel workspace: richiesta pulizia all'agente.`
      : `📁 Il comando ha creato ${dirList} annidata nel workspace: il progetto deve stare nella radice.`,
    directive,
    { category: 'system_alert' }
  )
}

/**
 * Registers the files a successful shell command created or rewrote, and reports any project
 * directory it left in the workspace root.
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
export function recordCommandTouchedFiles(ctx: ToolResultProcessingContext, commandFailed = false) {
  if (ctx.parsedTool.tool !== 'run_command' || !ctx.workspacePath) return

  const scan = scanCommandTouchedFiles(ctx.workspacePath, ctx.toolStartedAtMs)
  reportNestedProjectDirs(ctx, scan.createdTopLevelDirs, commandFailed)

  // A failed command's leftovers are debris, not deliverables: they must never count as file
  // mutations, and above all must never advance a milestone. Reporting them is the whole job.
  if (commandFailed || scan.files.length === 0) return

  let newlyTracked = 0
  for (const relativePath of scan.files) {
    const absolutePath = path.join(ctx.workspacePath, relativePath)
    if (ctx.sessionChangedFiles.has(absolutePath)) continue
    ctx.sessionChangedFiles.set(absolutePath, { additions: 0, deletions: 0 })
    newlyTracked++
  }

  ctx.flags.hasFileMutations = true
  invalidateVerifiedBuild(ctx)
  if (newlyTracked > 0) {
    ctx.emitLog(
      'info',
      `📂 ${newlyTracked} file tracciati dal comando eseguito${scan.truncated ? ' (scansione troncata: workspace molto grande)' : ''}.`
    )
  }

  // A scaffolder or codegen step can perfectly well deliver the active milestone's file,
  // so the whole set it touched counts as candidate evidence.
  advanceActiveMilestoneOnMutation(ctx, scan.files)
}

/**
 * Promotes every milestone the passing verification has just proven.
 *
 * One green build attests to all the files it compiled, so the promotion is plan-wide rather
 * than limited to whichever milestone happened to be active — that narrow rule is what left
 * earlier milestones stranded while a later one closed.
 */
export function promoteMilestonesProvenBy(
  deps: Pick<ToolResultProcessingContext, 'workspacePath' | 'goalPlanner' | 'emitLog'>,
  verificationCommand: string
) {
  if (!deps.workspacePath) return
  const probe = createWorkspaceDeliverableProbe(deps.workspacePath)
  const proven = selectMilestonesProvenByVerification(deps.goalPlanner.getMilestones(), (m) =>
    resolveMilestoneDeliverableStatus(m.title, probe)
  )
  if (proven.length === 0) return

  for (const milestone of proven) {
    deps.goalPlanner.updateMilestone(milestone.id, 'verified', promotionNote(verificationCommand))
  }
  const progress = deps.goalPlanner.getProgressSummary()
  deps.emitLog(
    'info',
    `✅ ${proven.length} milestone verificate da "${verificationCommand}": ${proven.map((m) => m.id).join(', ')} (${progress.completed}/${progress.total}).`
  )
}

/**
 * Milestone auto-verification is driven by run_tests, open_in_browser, and successful build/test commands.
 */
export function trackVerification(ctx: ToolResultProcessingContext, isToolFailure: boolean) {
  if (ctx.toolRes.verification?.ran) {
    const activeM = ctx.goalPlanner.getActiveMilestone()
    if (ctx.toolRes.verification.passed) {
      ctx.flags.hasVerifiedBuild = true
      promoteMilestonesProvenBy(ctx, 'run_tests')
    } else if (activeM) {
      ctx.goalPlanner.updateMilestone(activeM.id, 'failed', 'run_tests reported failures.')
    }
    return
  }

  if (ctx.parsedTool.tool === 'open_in_browser' && !isToolFailure) {
    // Opening a source file in a browser shows text; it proves nothing about the project
    // building or running. Treating it as verification let a project whose index.html
    // referenced a src/main.tsx that was never written pass the Definition of Done gate
    // (session-1787471833056-o5fk, steps 41-44). See browserPreviewVerification.ts.
    const previewTarget = ctx.parsedTool.parameters?.filePath || ctx.parsedTool.parameters?.url
    if (!isBrowserRenderableTarget(previewTarget)) {
      ctx.emitLog(
        'info',
        `👁️ Anteprima aperta su "${previewTarget}": non vale come verifica, non è una pagina renderizzata.`,
        'Esegui una build, un typecheck o un test per verificare il progetto.'
      )
      return
    }

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
    promoteMilestonesProvenBy(ctx, ctx.parsedTool.parameters?.command || 'verification command')
  }
}
