import path from 'node:path'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { resolveMilestoneDeliverableStatus, isDeliverableOfMilestone, extractDeliverablePaths, findUnsatisfiedDeliverables, AWAITING_VERIFICATION_MARKER } from '../domain/agent/milestoneDeliverableResolver'
import { createWorkspaceDeliverableProbe } from '../infrastructure/filesystem/workspaceDeliverableProbe'
import {
  awaitingVerificationNote,
  partialDeliveryDirective,
  redeliveredMilestoneDirective,
  promotionNote,
  selectMilestonesProvenByVerification,
} from '../domain/agent/milestoneVerificationPromotion'
import { scanCommandTouchedFiles } from '../infrastructure/filesystem/commandTouchedFilesScanner'
import { isCompletionMilestoneTitle } from '../domain/agent/planAndSolveGraph'
import { compileSessionStopSummary } from '../domain/agent/sessionDebtTracker'
import { isBrowserRenderableTarget } from '../domain/agent/browserPreviewVerification'
import { checkVerificationCommandSafety } from '../domain/agent/verificationCommandSafety'
import { resolvePlanDirective } from '../domain/agent/planDirectiveArbiter'
import { resolvePrimaryProfileVerificationTargets } from '../domain/agent/projectProfileVerificationResolver'
import { discoverProjectProfile } from '../infrastructure/filesystem/projectProfileDiscovery'
import { readWorkspaceManifest } from '../infrastructure/filesystem/workspaceManifestReader'
import { agentToolFileRepository } from '../infrastructure/filesystem/agentToolFileRepository'
import { scanUndeclaredImports } from '../infrastructure/filesystem/undeclaredImportScanner'
import { extractRequestedPackages, packagesWithFailedInstall } from '../domain/agent/installCommandParser'
import { isVerificationFailing } from '../domain/agent/verificationAttemptTracker'
import { buildDiagnosticFixDirective, diagnosticFixTargetFile } from '../domain/agent/compilerDiagnosticDirective'
import { readLocalModuleExports, readPackageExports } from '../infrastructure/filesystem/packageExportScanner'
import { checkHtmlEntrypoint, CONVENTIONAL_ENTRY_PATHS } from '../domain/agent/entrypointIntegrity'
import type { PlanDirectiveDecision } from '../domain/agent/planDirectiveArbiter'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
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

  // What the USER gets. `cbRes.suggestedAction` is written for the model ("Proceed immediately
  // to applying file changes or call finish tool") and used to be handed to the user verbatim
  // as the entire account of the run — see compileSessionStopSummary.
  const milestones = ctx.goalPlanner.getMilestones()
  const userSummary = compileSessionStopSummary({
    reason: cbRes.reason || cbMsg,
    stepCount: ctx.stepCount,
    completed: milestones.filter((m) => m.status === 'verified').map((m) => `${m.id}: ${m.title}`),
    outstanding: milestones
      .filter((m) => m.status !== 'verified' && !isCompletionMilestoneTitle(m.title))
      .map((m) => `${m.id}: ${m.title}${m.status === 'failed' ? ' (fallita)' : ''}`),
    modifiedFiles: Array.from(ctx.sessionChangedFiles.keys()),
  })

  // Every session-ending path must leave an outcome in the audit log; this one and the
  // stagnation abort in handleLoopDetection were the two that did not.
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, false, userSummary)
  }
  ctx.emitDone(false, userSummary)
  await ctx.persistCurrentState()
  ctx.finalizeSession()
  return { outcome: 'return', result: { success: false, summary: userSummary } }
}

/**
 * Hands the model the list of files its active milestone still owes.
 *
 * Recorded as its own episodic entry rather than appended to the write result, because the
 * result was already recorded as SUCCESS by the time this runs — and it IS a success: the file
 * landed. What follows is not a correction of that write but the next instruction. Same
 * mechanism `reportNestedProjectDirs` uses, and the episodic buffer deduplicates by tool and
 * target, so re-writing the same file does not stack copies of this text in the prompt.
 */
function reportPartialDelivery(
  ctx: ToolResultProcessingContext,
  milestone: { id: string; title: string },
  evidencePath: string,
  probe: ReturnType<typeof createWorkspaceDeliverableProbe>
) {
  // `evidencePath` arrives as whatever the tool reported — a workspace-relative path from
  // write_file, an absolute one from a command scan — while the deliverables come out of the
  // title in relative form. Compared verbatim, an absolute evidence path would never match and
  // the file just written would be listed back as still missing.
  const normalisedEvidence = evidencePath.replace(/\\/g, '/')
  const missing = findUnsatisfiedDeliverables(milestone.title, probe).filter(
    (candidate) => normalisedEvidence !== candidate && !normalisedEvidence.endsWith(`/${candidate}`)
  )
  // Empty when the file just written is itself the unsatisfied one — a placeholder body, say.
  // The import gate and the placeholder rules already speak to that; repeating it here as
  // "you still owe this file" would contradict the write result the model just read.
  if (missing.length === 0) return

  const directive = partialDeliveryDirective(milestone.id, evidencePath, missing)
  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: ctx.parsedTool.tool,
      target: evidencePath,
      // BLOCKED is the only status that routes a directive into the durable failure buffer,
      // where it survives FIFO trimming — but the write was NOT blocked, and the trajectory
      // table renders this summary next to that status word. It has to lead with what actually
      // happened, or the model reads its own successful write back as a rejection.
      status: 'BLOCKED',
      summary: `Write accepted — milestone ${milestone.id} still owes ${missing.join(', ')}`,
    },
    directive
  )
  ctx.emitLog(
    'info',
    `📄 Milestone ${milestone.id}: mancano ancora ${missing.map((m) => `"${m}"`).join(', ')}.`,
    directive,
    { category: 'system_alert' }
  )
}

/**
 * Reports a write that re-delivered a milestone which was already complete.
 *
 * The twin of `reportPartialDelivery` for the branch that only ever spoke to the user. Same
 * plumbing and same reason: BLOCKED is the only status that routes a directive into the
 * durable failure buffer, and the summary leads with what actually happened, because the
 * trajectory table prints it next to that word and the write was not blocked.
 *
 * Fires only on a RE-delivery — the milestone already carried its awaiting-verification note
 * before this write — so a first, legitimate completion stays silent. A byte-identical rewrite
 * never reaches here at all: redundantWriteDetector answers that one earlier.
 */
function reportRedelivery(
  ctx: ToolResultProcessingContext,
  milestone: { id: string; title: string },
  evidencePath: string,
  probe: ReturnType<typeof createWorkspaceDeliverableProbe>
) {
  const active = ctx.goalPlanner.getActiveMilestone()
  const nextNeed =
    active && active.id !== milestone.id && !isCompletionMilestoneTitle(active.title)
      ? (() => {
          const missing = findUnsatisfiedDeliverables(active.title, probe)
          return missing.length > 0 ? { milestoneId: active.id, missingPaths: missing } : null
        })()
      : null

  const directive = redeliveredMilestoneDirective(milestone.id, evidencePath, nextNeed)
  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: ctx.parsedTool.tool,
      target: evidencePath,
      status: 'BLOCKED',
      summary: `Write accepted — milestone ${milestone.id} was already complete before it`,
    },
    directive
  )
  ctx.emitLog(
    'info',
    `🔁 Milestone ${milestone.id} era gia' completa: la riscrittura di "${evidencePath}" non ha fatto avanzare il piano.`,
    directive,
    { category: 'system_alert' }
  )
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
  const workspacePath = ctx.workspacePath
  if (!workspacePath) {
    const activeM = ctx.goalPlanner.getActiveMilestone()
    if (activeM && activeM.status === 'pending' && !isCompletionMilestoneTitle(activeM.title)) {
      ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress')
    }
    return
  }

  const probe = createWorkspaceDeliverableProbe(workspacePath)
  let advancedAny = false

  for (const milestone of ctx.goalPlanner.getMilestones()) {
    if (milestone.status === 'verified' || milestone.status === 'failed' || isCompletionMilestoneTitle(milestone.title)) {
      continue
    }

    const evidencePath = mutatedPaths.find((candidate) => isDeliverableOfMilestone(milestone.title, candidate))
    if (!evidencePath) continue

    const status = resolveMilestoneDeliverableStatus(milestone.title, probe)
    if (status === 'satisfied') {
      // Already carrying the note means this milestone was complete BEFORE this write, so the
      // write re-delivered it. The branch used to record the note again and speak only to the
      // user; the model read `Successfully wrote file` and nothing else, which is
      // indistinguishable from progress. See redeliveredMilestoneDirective.
      const wasAlreadySatisfied = Boolean(milestone.notes && milestone.notes.includes(AWAITING_VERIFICATION_MARKER))
      ctx.goalPlanner.updateMilestone(milestone.id, 'in_progress', awaitingVerificationNote(evidencePath))
      ctx.emitLog(
        'info',
        `✏️ Milestone ${milestone.id}: scritto "${evidencePath}", tutti i file richiesti sono presenti. In attesa di una verifica che passi.`
      )
      if (wasAlreadySatisfied) reportRedelivery(ctx, milestone, evidencePath, probe)
      advancedAny = true
      continue
    }

    if (milestone.status === 'pending') {
      ctx.goalPlanner.updateMilestone(milestone.id, 'in_progress')
      advancedAny = true
    }

    // The branch that used to say nothing. The write landed on one of this milestone's files
    // and the others are still missing — a fact this exact line already computed and kept to
    // itself, which is how a model came to rewrite `postcss.config.js` eight times while
    // `tailwind.config.js` was never written at all. See partialDeliveryDirective.
    if (status === 'unsatisfied') {
      reportPartialDelivery(ctx, milestone, evidencePath, probe)
    }
  }

  if (!advancedAny) {
    const activeM = ctx.goalPlanner.getActiveMilestone()
    if (activeM && activeM.status === 'pending' && !isCompletionMilestoneTitle(activeM.title)) {
      ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress')
    }
  }
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
 * The milestones a passing verification WOULD promote, without promoting them.
 *
 * Split out so a caller can ask the question before paying for the answer. The terminal check
 * at budget exhaustion (budgetExhaustionVerification.ts) is worth minutes of `npm run build`
 * only when the plan actually holds milestones in the state that check would close; asking
 * here is the difference between spending that on a run it helps and on every run.
 */
export function selectMilestonesAwaitingVerification(
  deps: Pick<ToolResultProcessingContext, 'workspacePath' | 'goalPlanner'>
): { id: string; title: string }[] {
  if (!deps.workspacePath) return []
  const probe = createWorkspaceDeliverableProbe(deps.workspacePath)
  return selectMilestonesProvenByVerification(deps.goalPlanner.getMilestones(), (m) =>
    resolveMilestoneDeliverableStatus(m.title, probe)
  )
}

/**
 * Promotes every milestone the passing verification has just proven, and reports how many.
 *
 * One green build attests to all the files it compiled, so the promotion is plan-wide rather
 * than limited to whichever milestone happened to be active — that narrow rule is what left
 * earlier milestones stranded while a later one closed.
 *
 * The count is returned because the caller at budget exhaustion states it in the session
 * summary; the callers on the tool-result path ignore it, as they always did.
 */
export function promoteMilestonesProvenBy(
  deps: Pick<ToolResultProcessingContext, 'workspacePath' | 'goalPlanner' | 'emitLog'>,
  verificationCommand: string
): number {
  const proven = selectMilestonesAwaitingVerification(deps)
  if (proven.length === 0) return 0

  for (const milestone of proven) {
    deps.goalPlanner.updateMilestone(milestone.id, 'verified', promotionNote(verificationCommand))
  }
  const progress = deps.goalPlanner.getProgressSummary()
  deps.emitLog(
    'info',
    `✅ ${proven.length} milestone verificate da "${verificationCommand}": ${proven.map((m) => m.id).join(', ')} (${progress.completed}/${progress.total}).`
  )
  return proven.length
}

/**
 * The single directive this turn's plan block carries, or the ordinary focus block.
 *
 * The one place that reads the workspace on behalf of the arbiter. Every fact it gathers comes
 * from the same probe and the same manifest the promotion path uses, so the plan block and the
 * loop guard cannot end up asserting different things about the same milestone in the same
 * turn — which they did, three times, before the arbiter existed.
 *
 * Returns the neutral `focus` decision whenever there is no workspace to probe: without one
 * nothing can be shown to be finished, installed or verified, and inventing any of the three
 * would be the fabricated verification the promotion rules exist to prevent.
 */
export function resolvePlanDirectiveForTurn(
  workspacePath: string | null | undefined,
  goalPlanner: GoalDecompositionPlanner,
  hasVerifiedBuild: boolean,
  episodes: readonly { tool: string; target?: string; status: 'SUCCESS' | 'FAILURE' | 'BLOCKED' }[] = [],
  /**
   * The raw output of the last failing verification, when the caller can supply it. The plan
   * block then CARRIES the diagnostic instead of pointing at a tool result that may already have
   * aged out of the history — see buildVerificationFailingDirective.
   */
  lastVerificationFailureOutput: string | null = null
): PlanDirectiveDecision {
  if (!workspacePath) return { kind: 'focus', blockDirective: null, closureStepDirective: null }

  const probe = createWorkspaceDeliverableProbe(workspacePath)
  const manifest = readWorkspaceManifest(workspacePath)
  const profile = discoverProjectProfile(workspacePath)
  const verification = resolvePrimaryProfileVerificationTargets(profile)[0] ?? null
  const declared = Object.keys({
    ...(manifest.packageJson?.dependencies ?? {}),
    ...(manifest.packageJson?.devDependencies ?? {}),
  })

  return resolvePlanDirective({
    hasVerifiedBuild,
    milestones: goalPlanner.getMilestones(),
    activeMilestone: goalPlanner.getActiveMilestone(),
    deliverableStatusOf: (m) => resolveMilestoneDeliverableStatus(m.title, probe),
    // Only ever non-empty for a project that declares dependencies: a workspace with no
    // manifest offers nothing to install, and reporting "0 missing" would be noise.
    missingDependencies: declared.length > 0 ? agentToolFileRepository.missingFromNodeModules(workspacePath, declared) : [],
    // A bounded synchronous AST walk, the same order of cost as the repo map this turn already
    // builds. depcheck answers the same question far better and stays where it is — inside the
    // finish gate — because it is asynchronous and carries a 60-second timeout.
    undeclaredDependencies: scanUndeclaredImports(workspacePath),
    // Read back from the session's own trajectory rather than kept as a second piece of state:
    // the episodes are already recorded, already persisted, and already say which installs
    // failed and which later succeeded.
    packagesWithFailedInstall: packagesWithFailedInstall(episodes),
    verificationCommand: verification,
    verificationFailing: isVerificationFailing(episodes, verification?.command),
    verificationFailureDirective: lastVerificationFailureOutput
      ? buildDiagnosticFixDirective(
          lastVerificationFailureOutput,
          (pkg) => (workspacePath ? readPackageExports(workspacePath, pkg) : []),
          (importingFile, specifier) =>
            workspacePath ? readLocalModuleExports(workspacePath, importingFile, specifier) : []
        )
      : null,
    verificationFailureTargetFile: lastVerificationFailureOutput
      ? diagnosticFixTargetFile(lastVerificationFailureOutput)
      : null,
    disconnectedEntrypoint: resolveDisconnectedEntrypoint(workspacePath, probe),
  })
}

/**
 * Whether every file the ACTIVE milestone names is on disk with real content.
 *
 * Asked by the loop guard before it abandons that milestone. Measured on the live run of
 * 2026-08-24, steps 17-18: the model repeated a failing `npm run build`, and the structural
 * escape marked m-1 "Create `package.json`" FAILED — a file it had written correctly at step
 * 1 and which was on disk the whole time. The milestone was not what the model was stuck on;
 * the build error was. Before this wave the case was unreachable, because the model never ran
 * a command at all.
 *
 * A milestone naming no artefact answers `false`: nothing on disk can speak for it, so the
 * escape keeps its existing power over exactly the milestones that can genuinely deadlock.
 */
export function isActiveMilestoneDelivered(
  workspacePath: string | null | undefined,
  goalPlanner: GoalDecompositionPlanner,
  loopTarget?: string | null
): boolean {
  if (!workspacePath) return false
  const active = goalPlanner.getActiveMilestone()
  if (!active || isCompletionMilestoneTitle(active.title)) return false

  // A loop on a file the milestone itself names IS about this milestone, and the escape must
  // keep its power there. Compared on normalised paths because tool targets arrive absolute
  // while deliverables come out of the title relative — a literal comparison would call every
  // loop unrelated and disarm the escape completely.
  if (loopTarget) {
    const normalisedTarget = loopTarget.replace(/\\/g, '/').toLowerCase()
    const ownFiles = extractDeliverablePaths(active.title).map((p) => p.replace(/\\/g, '/').toLowerCase())
    if (ownFiles.some((file) => normalisedTarget === file || normalisedTarget.endsWith(`/${file}`))) return false
  }

  const probe = createWorkspaceDeliverableProbe(workspacePath)
  return resolveMilestoneDeliverableStatus(active.title, probe) === 'satisfied'
}

/**
 * Milestone auto-verification is driven by run_tests and successful build/test commands.
 * A browser preview is evidence for the user, but cannot establish build/typecheck/test health.
 */
export function trackVerification(ctx: ToolResultProcessingContext, isToolFailure: boolean) {
  if (
    ctx.parsedTool.tool === 'run_command' &&
    isToolFailure &&
    extractRequestedPackages(ctx.parsedTool.parameters?.command || '').length > 0
  ) {
    // A failed dependency install invalidates a prior green check even when npm left no files
    // behind: the check predates the dependency-resolution attempt and cannot prove the current
    // dependency state. Without this reset, a build in step 1 hid `dependencies_uninstallable`
    // after the install failed, so the closure directive kept the agent away from the importer.
    invalidateVerifiedBuild(ctx)
  }

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

    ctx.emitLog(
      'info',
      `👁️ Anteprima aperta su "${previewTarget}": evidenza raccolta, ma non promuove il milestone a verified.`,
      'Esegui build, typecheck o test con esito positivo per ottenere la verifica del progetto.'
    )
    return
  }

  if (ctx.parsedTool.tool !== 'run_command') return

  // A successful build/typecheck/lint satisfies the Definition of Done gate and advances verification milestones
  const rawCmd = ctx.parsedTool.parameters?.command || ''
  const cmdStr = rawCmd.toLowerCase()
  // The keyword scan alone is a substring match on the command text, so `touch src/test.tsx`
  // matches "test" and `echo "build ok" > out.log` matches "build" — both would have raised
  // hasVerifiedBuild and promoted milestones plan-wide on a command that wrote the workspace
  // and could not fail. The safety check is what makes the keyword mean what it reads as.
  const isVerificationCmd =
    ['test', 'typecheck', 'build', 'lint', 'pytest', 'tsc'].some((kw) => cmdStr.includes(kw)) &&
    checkVerificationCommandSafety(rawCmd).isSafe
  if (isVerificationCmd && !ctx.toolRes.outputForHistory.includes('[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]') && !isToolFailure) {
    ctx.flags.hasVerifiedBuild = true
    promoteMilestonesProvenBy(ctx, ctx.parsedTool.parameters?.command || 'verification command')
  }
}

/**
 * The project's HTML entry page when it loads none of the project's own code, or null.
 *
 * Reuses the deliverable probe rather than touching `fs` again: it already answers "is this
 * path on disk and what does it hold", with the same workspace confinement.
 */
function resolveDisconnectedEntrypoint(
  workspacePath: string,
  probe: ReturnType<typeof createWorkspaceDeliverableProbe>
): { htmlPath: string; expectedEntry: string } | null {
  const html = probe('index.html')
  // No page, or one too large to have been read back: nothing to judge either way.
  if (!html.exists || html.content === undefined) return null

  const entriesOnDisk = CONVENTIONAL_ENTRY_PATHS.filter((candidate) => probe(candidate).exists)
  const verdict = checkHtmlEntrypoint(html.content, entriesOnDisk)
  return verdict.ok || !verdict.expectedEntry ? null : { htmlPath: 'index.html', expectedEntry: verdict.expectedEntry }
}
