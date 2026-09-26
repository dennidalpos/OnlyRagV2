import type { AppSettings } from '../../../shared/types'
import { DEFAULT_APP_SETTINGS } from '../../../shared/domain/settings/appSettingsDefaults'
import path from 'node:path'
import { recordGuardEvent } from '../domain/agent/agentGuardEvents'
import {
  resolveMilestoneDeliverableStatus,
  isDeliverableOfMilestone,
  extractDeliverablePaths,
  findUnsatisfiedDeliverables,
  AWAITING_VERIFICATION_MARKER,
} from '../../../shared/domain/agent/milestoneDeliverableResolver'
import { captureMilestoneFileEvidence, createWorkspaceDeliverableProbe } from '../infrastructure/filesystem/workspaceDeliverableProbe'
import {
  awaitingVerificationNote,
  partialDeliveryDirective,
  redeliveredMilestoneDirective,
  promotionNote,
  selectMilestonesProvenByVerification,
} from '../domain/agent/milestoneVerificationPromotion'
import { scanCommandTouchedFiles } from '../infrastructure/filesystem/commandTouchedFilesScanner'
import { isCompletionMilestoneTitle } from '../../../shared/domain/agent/planAndSolveGraph'
import { compileSessionStopSummary } from '../domain/agent/sessionDebtTracker'
import { isBrowserRenderableTarget } from '../domain/agent/browserPreviewVerification'
import { checkVerificationCommandSafety } from '../../../shared/domain/agent/verificationCommandSafety'
import { resolvePlanDirective } from '../domain/agent/planDirectiveArbiter'
import { resolvePrimaryProfileVerificationTargets } from '../domain/agent/projectProfileVerificationResolver'
import { discoverProjectProfile } from '../infrastructure/filesystem/projectProfileDiscovery'
import { readWorkspaceManifest } from '../infrastructure/filesystem/workspaceManifestReader'
import { agentToolFileRepository } from '../infrastructure/filesystem/agentToolFileRepository'
import { scanUndeclaredImports } from '../infrastructure/filesystem/undeclaredImportScanner'
import { extractRequestedPackages, packagesWithFailedInstall } from '../domain/agent/installCommandParser'
import { isVerificationFailing } from '../domain/agent/verificationAttemptTracker'
import { isProjectTestCommand, isUsableTestScript } from '../domain/agent/behaviorTestDirective'
import { isTestFilePath } from '../domain/agent/testFailureDiagnostic'
import { extractPackageImportStatements } from '../domain/agent/importDeclarationGate'
import { pendingManifestAdvice } from '../domain/agent/dependencyVersionReality'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { buildDiagnosticFixAdvice, diagnosticFixRequiredTools, diagnosticFixTargetFile } from '../domain/agent/compilerDiagnosticDirective'
import {
  isBinaryInstalled,
  packageHasStyleEntry,
  readLocalModuleExports,
  readPackageExports,
  toWorkspaceRelativePath,
  readLocalModuleSource,
  readWorkspaceTextFile,
} from '../infrastructure/filesystem/packageExportScanner'
import { checkHtmlEntrypoint, CONVENTIONAL_ENTRY_PATHS } from '../domain/agent/entrypointIntegrity'
import type { PlanDirectiveDecision } from '../domain/agent/planDirectiveArbiter'
import type { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { ToolResultProcessingContext, ToolResultProcessingOutcome } from './agentOrchestratorRunContext'
import { emitLocalizedLog } from './agentOrchestratorTypes'
import { formatAgentTextIt } from '../../../shared/domain/agent/agentMainText'

/** Returns a `return` outcome once the progress policy's no-mutation budget is spent. */
export async function runCircuitBreaker(ctx: ToolResultProcessingContext, isMutating: boolean): Promise<ToolResultProcessingOutcome | null> {
  const cbRes = ctx.state.progress.onStepExecuted(isMutating)
  if (!cbRes) return null

  // The circuit breaker is forcing a pause/intervention due to stagnation/looping
  emitLocalizedLog(ctx.emitLog, 'info', { key: 'circuitBreakerTriggered', params: { reason: cbRes.reason } })

  // What the USER gets.
  const milestones = ctx.goalPlanner.getMilestones()
  const userSummary = compileSessionStopSummary({
    reason: formatAgentTextIt(cbRes.reason),
    stepCount: ctx.stepCount,
    completed: milestones.filter((m) => m.status === 'verified').map((m) => `${m.id}: ${m.title}`),
    outstanding: milestones
      .filter((m) => m.status !== 'verified' && !isCompletionMilestoneTitle(m))
      .map((m) => `${m.id}: ${m.title}${m.status === 'failed' ? ' (fallita)' : ''}`),
    modifiedFiles: Array.from(ctx.sessionChangedFiles.keys()),
  })

  const closure = await ctx.closeApplicationRun({
    trigger: 'guard_stop',
    guard: cbRes.guard,
    reason: cbRes.reason,
    modelSummary: userSummary,
  })
  return closure.outcome === 'closed' ? { outcome: 'return', result: closure.result } : { outcome: 'continue' }
}

/** Hands the model the list of files its active milestone still owes. */
function reportPartialDelivery(
  ctx: ToolResultProcessingContext,
  milestone: { id: string; title: string },
  evidencePath: string,
  probe: ReturnType<typeof createWorkspaceDeliverableProbe>,
) {
  // `evidencePath` arrives as whatever the tool reported — a workspace-relative path from write_file, an absolute one from a command scan — while the deliverables come out of the title in relative form.
  const normalisedEvidence = evidencePath.replace(/\\/g, '/')
  const missing = findUnsatisfiedDeliverables(milestone, probe).filter(
    (candidate) => normalisedEvidence !== candidate && !normalisedEvidence.endsWith(`/${candidate}`),
  )
  // Empty when the file just written is itself the unsatisfied one — a placeholder body, say.
  if (missing.length === 0) return

  const directive = partialDeliveryDirective(milestone.id, evidencePath, missing)
  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: ctx.parsedTool.tool,
      target: evidencePath,
      // BLOCKED is the only status that routes a directive into the durable failure buffer, where it survives FIFO trimming — but the write was NOT blocked, and the trajectory table renders this summary next to that status word.
      status: 'BLOCKED',
      summary: `Write accepted — milestone ${milestone.id} still owes ${missing.join(', ')}`,
    },
    directive,
  )
  emitLocalizedLog(
    ctx.emitLog,
    'info',
    { key: 'milestoneStillMissing', params: { id: milestone.id, missing: missing.map((m) => `"${m}"`).join(', ') } },
    directive,
    {
      category: 'system_alert',
    },
  )
}

/**
 * Reports a write that re-delivered an already complete milestone.
 * Routes a directive into episodicCompactor as BLOCKED to steer model to unsatisfied milestones.
 */
function reportRedelivery(
  ctx: ToolResultProcessingContext,
  milestone: { id: string; title: string },
  evidencePath: string,
  probe: ReturnType<typeof createWorkspaceDeliverableProbe>,
) {
  const active = ctx.goalPlanner.getActiveMilestone()
  const nextNeed =
    active && active.id !== milestone.id && !isCompletionMilestoneTitle(active)
      ? (() => {
          const missing = findUnsatisfiedDeliverables(active, probe)
          return missing.length > 0 ? { milestoneId: active.id, missingPaths: missing } : null
        })()
      : null

  const directive = redeliveredMilestoneDirective(milestone.id, evidencePath, nextNeed)
  ctx.episodicCompactor.recordStep(
    {
      step: ctx.stepCount,
      tool: ctx.parsedTool.tool,
      target: evidencePath,
      status: 'SUCCESS',
      summary: `Write applied to a file of milestone ${milestone.id}, which was already complete`,
    },
    directive,
  )
  emitLocalizedLog(ctx.emitLog, 'info', { key: 'milestoneRedelivered', params: { id: milestone.id, path: evidencePath } }, directive, {
    category: 'system_alert',
  })
}

/** Advances the active milestone when the file mutation that just landed is evidence for it. */
function advanceActiveMilestoneOnMutation(ctx: ToolResultProcessingContext, mutatedPaths: Array<string | undefined>) {
  const workspacePath = ctx.workspacePath
  if (!workspacePath) {
    const activeM = ctx.goalPlanner.getActiveMilestone()
    if (activeM && activeM.status === 'pending' && !isCompletionMilestoneTitle(activeM)) {
      ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress')
    }
    return
  }

  const probe = createWorkspaceDeliverableProbe(workspacePath)
  let advancedAny = false

  for (const milestone of ctx.goalPlanner.getMilestones()) {
    if (milestone.status === 'verified' || milestone.status === 'failed' || isCompletionMilestoneTitle(milestone)) {
      continue
    }

    const evidencePath = mutatedPaths.find((candidate) => isDeliverableOfMilestone(milestone, candidate))
    if (!evidencePath) continue

    const status = resolveMilestoneDeliverableStatus(milestone, probe)
    if (status === 'satisfied') {
      // Awaiting verification note indicates milestone was complete before this write (re-delivery).
      const wasAlreadySatisfied = Boolean(milestone.notes && milestone.notes.includes(AWAITING_VERIFICATION_MARKER))
      ctx.goalPlanner.updateMilestone(milestone.id, 'in_progress', awaitingVerificationNote(evidencePath))
      emitLocalizedLog(ctx.emitLog, 'info', { key: 'milestoneAwaitingVerification', params: { id: milestone.id, path: evidencePath } })
      if (wasAlreadySatisfied) reportRedelivery(ctx, milestone, evidencePath, probe)
      advancedAny = true
      continue
    }

    if (milestone.status === 'pending') {
      ctx.goalPlanner.updateMilestone(milestone.id, 'in_progress')
      advancedAny = true
    }

    // Emits partial delivery directive when other required milestone deliverables are still missing.
    if (status === 'unsatisfied') {
      reportPartialDelivery(ctx, milestone, evidencePath, probe)
    }
  }

  if (!advancedAny) {
    const activeM = ctx.goalPlanner.getActiveMilestone()
    if (activeM && activeM.status === 'pending' && !isCompletionMilestoneTitle(activeM)) {
      ctx.goalPlanner.updateMilestone(activeM.id, 'in_progress')
    }
  }
}

/** A file written after the last passing build makes that build stale evidence. */
function invalidateVerifiedBuild(ctx: ToolResultProcessingContext) {
  ctx.flags.hasVerifiedBuild = false
}

/** Checks if mutating targetParam invalidates the verified primary build. */
function mutationStalesVerifiedBuild(ctx: ToolResultProcessingContext, targetParam: string | undefined): boolean {
  if (!isTestFilePath(targetParam) || !ctx.workspacePath) return true
  const primary = resolvePrimaryProfileVerificationTargets(discoverProjectProfile(ctx.workspacePath))[0]
  return !primary || primary.kind !== 'build' || primary.coverage !== 'entry-reachable'
}

export async function recordMutationSideEffects(ctx: ToolResultProcessingContext, targetParam: string | undefined) {
  ctx.flags.hasFileMutations = true
  if (mutationStalesVerifiedBuild(ctx, targetParam)) invalidateVerifiedBuild(ctx)
  // Checkpoint immediately on mutation so crash never loses disk state.
  await ctx.persistCurrentState()
  if (targetParam) {
    const snap = ctx.executionGuard.captureWorkspaceSnapshot([targetParam])
    const stagCheck = ctx.executionGuard.detectStateStagnation(snap)
    if (!stagCheck.allowed && stagCheck.suggestedAction) {
      ctx.episodicCompactor.recordStep(
        { step: ctx.stepCount, tool: ctx.parsedTool.tool, status: 'BLOCKED', summary: stagCheck.reason || 'State Stagnation' },
        stagCheck.suggestedAction,
      )
      recordGuardEvent(ctx.state.guardEvents, 'fs_oscillation', 'advise', ctx.stepCount)
      emitLocalizedLog(ctx.emitLog, 'info', { key: 'executionGuardNotice', params: { reason: String(stagCheck.reason) } })
    }
  }

  advanceActiveMilestoneOnMutation(ctx, [targetParam])
}

/** Reports a nested project directory a shell command left in the workspace root. */
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
    directive,
  )
  emitLocalizedLog(ctx.emitLog, 'info', { key: commandFailed ? 'failedCommandLeftDirs' : 'nestedProjectDirs', params: { dirs: dirList } }, directive, {
    category: 'system_alert',
  })
}

/** Registers the files a successful shell command created or rewrote, and reports any project directory it left in the workspace root. */
export function recordCommandTouchedFiles(ctx: ToolResultProcessingContext, commandFailed = false): string[] {
  if (ctx.parsedTool.tool !== 'run_command' || !ctx.workspacePath) return []

  const scan = scanCommandTouchedFiles(ctx.workspacePath, ctx.toolStartedAtMs)
  const touchedPaths = scan.files.map((relativePath) => path.join(ctx.workspacePath!, relativePath))
  reportNestedProjectDirs(ctx, scan.createdTopLevelDirs, commandFailed)

  // A failed command's leftovers are debris, not deliverables: they must never count as file
  // mutations, and above all must never advance a milestone. Reporting them is the whole job.
  if (commandFailed || scan.files.length === 0) return touchedPaths

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
    emitLocalizedLog(ctx.emitLog, 'info', {
      key: 'commandTrackedFiles',
      params: { count: newlyTracked, truncated: scan.truncated ? { key: 'commandScanTruncated' } : '' },
    })
  }

  // A scaffolder or codegen step can perfectly well deliver the active milestone's file,
  // so the whole set it touched counts as candidate evidence.
  advanceActiveMilestoneOnMutation(ctx, scan.files)
  return touchedPaths
}

/**
 * Previews milestones whose declared command matches the passing check and whose artifacts exist.
 */
export function selectMilestonesAwaitingVerification(
  deps: Pick<ToolResultProcessingContext, 'workspacePath' | 'goalPlanner'>,
  verificationCommand: string,
): { id: string; title: string }[] {
  if (!deps.workspacePath) return []
  const probe = createWorkspaceDeliverableProbe(deps.workspacePath)
  return selectMilestonesProvenByVerification(deps.goalPlanner.getMilestones(), verificationCommand, (m) => resolveMilestoneDeliverableStatus(m, probe))
}

/**
 * Promotes only milestones explicitly associated with the passing verification.
 */
export function promoteMilestonesProvenBy(
  deps: Pick<ToolResultProcessingContext, 'workspacePath' | 'goalPlanner' | 'emitLog'>,
  verificationCommand: string,
): number {
  const proven = selectMilestonesAwaitingVerification(deps, verificationCommand)
  if (proven.length === 0) return 0

  for (const milestone of proven) {
    const target = deps.goalPlanner.getMilestones().find((candidate) => candidate.id === milestone.id)
    if (target && deps.workspacePath) {
      const fileEvidence = captureMilestoneFileEvidence(deps.workspacePath, target)
      if (fileEvidence) target.fileEvidence = fileEvidence
    }
    deps.goalPlanner.updateMilestone(milestone.id, 'verified', promotionNote(verificationCommand))
  }
  const progress = deps.goalPlanner.getProgressSummary()
  emitLocalizedLog(deps.emitLog, 'info', {
    key: 'milestonesVerifiedBy',
    params: {
      count: proven.length,
      command: verificationCommand,
      ids: proven.map((m) => m.id).join(', '),
      completed: progress.completed,
      total: progress.total,
    },
  })
  return proven.length
}

/** Package installs reach the registry: only the network-approved policy can run them. */
export function installsAllowed(mode: AppSettings['capabilityPolicyMode']): boolean {
  return mode === 'network-approved'
}

/** The single directive this turn's plan block carries, or the ordinary focus block. */
export function resolvePlanDirectiveForTurn(
  workspacePath: string | null | undefined,
  goalPlanner: GoalDecompositionPlanner,
  hasVerifiedBuild: boolean,
  episodes: readonly { tool: string; target?: string; status: 'SUCCESS' | 'FAILURE' | 'BLOCKED' }[] = [],
  /** The raw output of the last failing run of a command, when the caller can supply it. */
  lastFailureOutputOf: (command: string) => string | null = () => null,
  /** Recent full tool outputs, where a pending package.json rewrite order is found. */
  recentFullLogs: readonly { step: number; output: string }[] = [],
  /** Capability policy of the run: without registry access the arbiter never orders an install. */
  capabilityPolicyMode: AppSettings['capabilityPolicyMode'] = DEFAULT_APP_SETTINGS.capabilityPolicyMode,
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
  // `npm test` and `npm run test` are one script, recorded under whichever spelling was run.
  const failureOutputOf = (command: string) =>
    lastFailureOutputOf(command) ?? (isProjectTestCommand(command) ? (lastFailureOutputOf('npm test') ?? lastFailureOutputOf('npm run test')) : null)
  const lastVerificationFailureOutput = verification ? failureOutputOf(verification.command) : null
  const workspaceFacts = {
    packageHasStyleEntry: (pkg: string) => packageHasStyleEntry(workspacePath, pkg),
    toWorkspaceRelative: (filePath: string) => toWorkspaceRelativePath(workspacePath, filePath),
    fileExists: (relativePath: string) => probe(relativePath).exists,
    binaryInstalled: (name: string) => isBinaryInstalled(workspacePath, name),
    readWorkspaceFile: (relativePath: string) => readWorkspaceTextFile(workspacePath, relativePath),
    readLocalModuleSource: (importingFile: string, specifier: string) => readLocalModuleSource(workspacePath, importingFile, specifier),
  }
  const diagnose = (output: string) =>
    buildDiagnosticFixAdvice(
      output,
      (pkg) => readPackageExports(workspacePath, pkg),
      (importingFile, specifier) => readLocalModuleExports(workspacePath, importingFile, specifier),
      workspaceFacts,
    )
  const behaviorFailureOutput = failureOutputOf('npm test')

  return resolvePlanDirective({
    hasVerifiedBuild,
    milestones: goalPlanner.getMilestones(),
    activeMilestone: goalPlanner.getActiveMilestone(),
    deliverableStatusOf: (m) => resolveMilestoneDeliverableStatus(m, probe),
    // Only ever non-empty for a project that declares dependencies: a workspace with no
    // manifest offers nothing to install, and reporting "0 missing" would be noise.
    // An order the policy then blocks is a guaranteed failed step (about 37 blocked installs under
    // offline-strict in tracker-rerun-01), so dependency directives exist only where installs can run.
    missingDependencies:
      installsAllowed(capabilityPolicyMode) && declared.length > 0 ? agentToolFileRepository.missingFromNodeModules(workspacePath, declared) : [],
    // A bounded synchronous AST walk, the same order of cost as the repo map this turn already builds.
    undeclaredDependencies: installsAllowed(capabilityPolicyMode) ? scanUndeclaredImports(workspacePath) : [],
    // Read back from the session's own trajectory rather than kept as a second piece of state: the episodes are already recorded, already persisted, and already say which installs failed and which later succeeded.
    packagesWithFailedInstall: packagesWithFailedInstall(episodes),
    pendingManifestAdvice: pendingManifestAdvice(recentFullLogs, episodes),
    importStatementsOf: (file, packageName) => {
      try {
        return extractPackageImportStatements(file, documentIoRepository.readText(path.join(workspacePath, file)), packageName)
      } catch {
        return []
      }
    },
    verificationCommand: verification,
    verificationFailing: isVerificationFailing(episodes, verification?.command),
    verificationFailureAdvice: lastVerificationFailureOutput ? diagnose(lastVerificationFailureOutput) : null,
    verificationFailureTargetFile: lastVerificationFailureOutput ? diagnosticFixTargetFile(lastVerificationFailureOutput, workspaceFacts) : null,
    verificationFailureTools: lastVerificationFailureOutput ? diagnosticFixRequiredTools(lastVerificationFailureOutput, workspaceFacts) : [],
    disconnectedEntrypoint: resolveDisconnectedEntrypoint(workspacePath, probe),
    packageTestScript: manifest.packageJson ? (manifest.packageJson.scripts?.test ?? null) : undefined,
    declaredPackages: declared,
    behaviorVerificationFailing: isBehaviorTestFailing(episodes),
    behaviorFailureAdvice: behaviorFailureOutput ? diagnose(behaviorFailureOutput) : null,
    behaviorFailureTargetFile: behaviorFailureOutput ? diagnosticFixTargetFile(behaviorFailureOutput, workspaceFacts) : null,
    behaviorFailureTools: behaviorFailureOutput ? diagnosticFixRequiredTools(behaviorFailureOutput, workspaceFacts) : [],
  })
}

/** `npm test` and `npm run test` run the same script, so either failing run counts. */
function isBehaviorTestFailing(episodes: readonly { tool: string; target?: string; status: 'SUCCESS' | 'FAILURE' | 'BLOCKED' }[]): boolean {
  const last = [...episodes].reverse().find((e) => e.tool === 'run_command' && isProjectTestCommand(e.target || ''))
  return last ? isVerificationFailing(episodes, last.target) : false
}

/** Whether every file the ACTIVE milestone names is on disk with real content. */
export function isActiveMilestoneDelivered(
  workspacePath: string | null | undefined,
  goalPlanner: GoalDecompositionPlanner,
  loopTarget?: string | null,
): boolean {
  if (!workspacePath) return false
  const active = goalPlanner.getActiveMilestone()
  if (!active || isCompletionMilestoneTitle(active)) return false

  // A loop on a file the milestone itself names IS about this milestone, and the escape must keep its power there.
  if (loopTarget) {
    const normalisedTarget = loopTarget.replace(/\\/g, '/').toLowerCase()
    const ownFiles = (active.filePaths?.length ? active.filePaths : extractDeliverablePaths(active.title)).map((p) => p.replace(/\\/g, '/').toLowerCase())
    if (ownFiles.some((file) => normalisedTarget === file || normalisedTarget.endsWith(`/${file}`))) return false
  }

  const probe = createWorkspaceDeliverableProbe(workspacePath)
  return resolveMilestoneDeliverableStatus(active, probe) === 'satisfied'
}

/**
 * Milestone auto-verification is driven by run_tests and successful build/test commands.
 * A browser preview is evidence for the user, but cannot establish build/typecheck/test health.
 */
export function trackVerification(ctx: ToolResultProcessingContext, isToolFailure: boolean) {
  if (ctx.parsedTool.tool === 'run_command' && isToolFailure && extractRequestedPackages(ctx.parsedTool.parameters?.command || '').length > 0) {
    // A failed dependency install invalidates a prior green check even when npm left no files behind: the check predates the dependency-resolution attempt and cannot prove the current dependency state.
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
    // Opening a source file in a browser shows text; it proves nothing about the project building or running.
    const previewTarget = ctx.parsedTool.parameters?.filePath || ctx.parsedTool.parameters?.url
    if (!isBrowserRenderableTarget(previewTarget)) {
      emitLocalizedLog(ctx.emitLog, 'info', { key: 'previewNotRendered', params: { target: String(previewTarget) } }, { key: 'previewNotRenderedHint' })
      return
    }

    emitLocalizedLog(ctx.emitLog, 'info', { key: 'previewNotPromoting', params: { target: String(previewTarget) } }, { key: 'previewNotPromotingHint' })
    return
  }

  if (ctx.parsedTool.tool !== 'run_command') return

  const rawCmd = ctx.parsedTool.parameters?.command || ''
  const normalizedCommand = rawCmd.trim().replace(/\s+/g, ' ').toLowerCase()
  const projectChecks = ctx.workspacePath ? resolvePrimaryProfileVerificationTargets(discoverProjectProfile(ctx.workspacePath)) : []
  // The project's own "test" script counts too: it is the only check that can prove a milestone
  // promising behavior, and it is rarely the primary one while a typecheck is declared.
  const runsDeclaredTestScript =
    isProjectTestCommand(rawCmd) && Boolean(ctx.workspacePath) && isUsableTestScript(readWorkspaceManifest(ctx.workspacePath!).packageJson?.scripts?.test)
  const isVerificationCmd =
    (projectChecks.some((target) => target.command.trim().replace(/\s+/g, ' ').toLowerCase() === normalizedCommand) || runsDeclaredTestScript) &&
    checkVerificationCommandSafety(rawCmd).isSafe
  if (isVerificationCmd && !ctx.toolRes.outputForHistory.includes('[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]') && !isToolFailure) {
    ctx.flags.hasVerifiedBuild = true
    promoteMilestonesProvenBy(ctx, ctx.parsedTool.parameters?.command || 'verification command')
  }
}

/** The project's HTML entry page when it loads none of the project's own code, or null. */
function resolveDisconnectedEntrypoint(
  workspacePath: string,
  probe: ReturnType<typeof createWorkspaceDeliverableProbe>,
): { htmlPath: string; expectedEntry: string } | null {
  const html = probe('index.html')
  // No page, or one too large to have been read back: nothing to judge either way.
  if (!html.exists || html.content === undefined) return null

  const entriesOnDisk = CONVENTIONAL_ENTRY_PATHS.filter((candidate) => probe(candidate).exists)
  const verdict = checkHtmlEntrypoint(html.content, entriesOnDisk)
  return verdict.ok || !verdict.expectedEntry ? null : { htmlPath: 'index.html', expectedEntry: verdict.expectedEntry }
}
