/** Selects one plan directive per turn from caller-supplied workspace facts. */

import { isCompletionMilestoneTitle } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { MilestoneDeliverableStatus } from '../../../../shared/domain/agent/milestoneDeliverableResolver'
import { assessPostVerificationClosure, buildClosureDirective } from './postVerificationClosure'
import { shouldDirectUnprovableClosure, buildUnprovableMilestoneDirective } from './unprovableMilestoneDirective'
import { buildVerificationFailingDirective } from './verificationAttemptTracker'
import { buildEntrypointDirective } from './entrypointIntegrity'
import type { SupportedToolName } from './agentTypes'

export type PlanDirectiveKind =
  /** The build is green and the plan is accounted for: close the session. */
  | 'session_closure'
  /** The code imports packages the manifest never declares: no build can resolve them. */
  | 'dependencies_undeclared'
  /** Those packages were already tried and cannot be installed: the importing file must change. */
  | 'dependencies_uninstallable'
  /** The manifest declares packages that are not installed: no build can pass until they are. */
  | 'dependencies_missing'
  /** Every open milestone has its files on disk and nothing has been verified: run the check. */
  | 'verification_due'
  /** The check has already run and failed with nothing written since: fix, do not re-run. */
  | 'verification_failing'
  /** The HTML entry page references none of the project's own code, so nothing ever runs. */
  | 'entrypoint_disconnected'
  /** The active milestone names no artefact, so writing files cannot close it. */
  | 'unprovable_milestone'
  /** Ordinary case: the standing focus block, unmodified. */
  | 'focus'

export interface PlanDirectiveDecision {
  kind: PlanDirectiveKind
  /** Replaces the ENTIRE active-milestone focus block when present. */
  blockDirective: string | null
  /** Replaces ONLY directive 2 inside the focus block; the rest of the block stands. */
  closureStepDirective: string | null
  /** Workspace files this directive orders the model to REWRITE, when it names any. */
  rewriteTargets?: readonly string[]
  /** Tools beyond the file edit that this directive orders (e.g. move_file to rename a file). */
  requiredTools?: readonly SupportedToolName[]
}

/** A package the code imports and package.json does not declare. */
export interface UndeclaredDependency {
  packageName: string
  /** Workspace-relative files that import it. */
  importedBy: readonly string[]
}

export interface PlanDirectiveInput {
  /** A real verification passed and no file has been written since. */
  hasVerifiedBuild: boolean
  milestones: readonly PlanMilestone[]
  /** The milestone the plan is currently focused on, as the planner resolves it. */
  activeMilestone: PlanMilestone | undefined
  deliverableStatusOf: (milestone: PlanMilestone) => MilestoneDeliverableStatus
  /**
   * Packages the manifest declares that are absent from `node_modules`. Empty both when
   * everything is installed and when the workspace declares nothing.
   */
  missingDependencies: readonly string[]
  /**
   * Packages the code on disk imports that the manifest does not declare. Disjoint from
   * `missingDependencies` by definition: that one is about what IS declared.
   */
  undeclaredDependencies: readonly UndeclaredDependency[]
  /** Packages this session already tried to install and failed on. */
  packagesWithFailedInstall: readonly string[]
  /** The command the project itself offers to prove it works, or null when it offers none. */
  verificationCommand: { command: string; source: string } | null
  /** The verification command has already run, failed, and nothing has been written since. */
  verificationFailing: boolean
  /**
   * The diagnostic directive built from the last failing verification, ready to be carried by the
   * plan block instead of referred to. Null when there is none to embed.
   */
  verificationFailureDirective?: string | null
  /** The file that directive orders written, so the prompt can carry its current content. */
  verificationFailureTargetFile?: string | null
  /** Tools beyond the file edit that the failure directive orders. */
  verificationFailureTools?: readonly SupportedToolName[]
  /**
   * The project's HTML entry page loads none of its own code. Null when the project has no
   * such page or the question does not apply. See entrypointIntegrity.ts.
   */
  disconnectedEntrypoint: { htmlPath: string; expectedEntry: string } | null
}

const FOCUS: PlanDirectiveDecision = { kind: 'focus', blockDirective: null, closureStepDirective: null }

/** Open milestones: the completion one belongs to `finish`, and `failed` was abandoned on purpose. */
function selectOpenMilestones(milestones: readonly PlanMilestone[]): PlanMilestone[] {
  return milestones.filter(
    (m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m)
  )
}

/**
 * Directive emitted when declared dependencies are missing from node_modules.
 * Ordered ahead of build to prevent misleading "vite: not found" errors.
 */
export function buildDependencyInstallDirective(missing: readonly string[]): string {
  const shown = missing.slice(0, 12)
  const overflow = missing.length - shown.length
  const list = shown.map((p) => `"${p}"`).join(', ')

  return [
    `[DEPENDENCIES NOT INSTALLED — INSTALL THEM NOW]`,
    `${missing.length} package${missing.length === 1 ? '' : 's'} declared in package.json ${missing.length === 1 ? 'is' : 'are'} missing from node_modules: ${list}${overflow > 0 ? ` (+${overflow} more)` : ''}.`,
    `No build, typecheck or test can pass until they are installed, and writing more files will not change that.`,
    `Directives:`,
    `1. Your next tool call MUST be "run_command" with the command: npm install`,
    `2. Do NOT write or rewrite any file this step, and do NOT edit package.json to work around the failure.`,
  ].join('\n')
}

/** Preserves an explicit user-requested first command against competing plan heuristics. */
export function buildExplicitFirstCommandDirective(userTask: string, isFirstTurn: boolean): string | null {
  if (!isFirstTurn) return null
  const match = userTask.match(/\bRun exactly\s+`([^`]+)`\s+first\b/i)
  if (!match) return null
  return [
    `[USER-MANDATED FIRST COMMAND]`,
    `The user explicitly required this command as the first action: ${match[1]}`,
    `Directives:`,
    `1. Your next tool call MUST be "run_command" with the command: ${match[1]}`,
    `2. Do NOT run a build, edit a file, or call any other tool before it.`,
  ].join('\n')
}

/**
 * Directive emitted when code imports packages not declared in package.json.
 * Mandates `npm install <pkg>` and names the importing file to prevent unguided edits.
 */
export function buildUndeclaredDependencyDirective(undeclared: readonly UndeclaredDependency[]): string {
  const shown = undeclared.slice(0, 8)
  const overflow = undeclared.length - shown.length
  const lines = shown.map((u, i) => `${i + 1}. "${u.packageName}" — imported by ${u.importedBy.slice(0, 3).join(', ')}`)
  const names = shown.map((u) => u.packageName).join(' ')

  return [
    `[UNDECLARED PACKAGES — THE BUILD CANNOT RESOLVE THEM]`,
    `The code on disk imports ${undeclared.length} package${undeclared.length === 1 ? '' : 's'} that package.json does not declare${overflow > 0 ? ` (${overflow} more not listed)` : ''}:`,
    ...lines,
    `Every build will fail on ${undeclared.length === 1 ? 'this' : 'these'} until package.json declares ${undeclared.length === 1 ? 'it' : 'them'}. Writing more files cannot change that.`,
    `Directives:`,
    `1. Your next tool call MUST be "run_command" with the command: npm install ${names}`,
    `2. If a package name above is one you invented and it does not exist on npm, the install will fail: in that case rewrite the file that imports it using only what the project already declares.`,
  ].join('\n')
}

/**
 * Directive emitted when a package install repeatedly fails (e.g. invalid name or unresolvable conflict).
 * Instructs model to rewrite the importing file using `write_file` on a single deterministic target.
 */
export function buildUninstallablePackageDirective(undeclared: readonly UndeclaredDependency[]): string {
  // Pin one deterministic target until resolved to prevent target oscillation across turns.
  const ordered = [...undeclared].sort((a, b) => a.packageName.localeCompare(b.packageName))
  const target = ordered[0]
  const file = [...target.importedBy].sort()[0]
  const others = ordered.length - 1

  return [
    `[THIS PACKAGE CANNOT BE INSTALLED — STOP TRYING]`,
    `You have run the install for "${target.packageName}" more than once in this session and it failed every time, including after any version conflict was resolved. Whatever the registry is answering, it is not going to change on another attempt.`,
    `The file that imports it is the thing to change now, not the command.`,
    ...(others > 0
      ? [
          `${others} other import${others === 1 ? '' : 's'} in this project ${others === 1 ? 'has' : 'have'} the same problem. ${others === 1 ? 'It is' : 'They are'} handled one at a time, after this one; this turn is about "${file}" only.`,
        ]
      : []),
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "${file}", with the complete file rewritten so that nothing in it imports "${target.packageName}", using only packages package.json already declares, and keeping the rest of the file's content intact.`,
    `2. Do NOT run any install command for "${target.packageName}" again, and do NOT write any other file this step.`,
  ].join('\n')
}

/** What the model is told when every deliverable it owes is on disk and nothing has proven it. */
export function buildVerificationDueDirective(verification: { command: string; source: string }): string {
  return [
    `[EVERY DELIVERABLE IS ON DISK — VERIFY THE PROJECT NOW]`,
    `Every milestone still open has all the files it names, with real content. Nothing further can be proven by writing files: no milestone can be marked verified until a real check passes over what is already there.`,
    `This project declares its own check (${verification.source}).`,
    `Directives:`,
    `1. Your next tool call MUST be "run_command" with the command: ${verification.command}`,
    `2. If it fails, read the error, fix the file it names, and run it again. Do NOT start new work while it is failing.`,
    `3. Do NOT invoke "finish" before that command has passed.`,
  ].join('\n')
}

/** The single directive for this turn, chosen by declared priority. */
export function resolvePlanDirective(input: PlanDirectiveInput): PlanDirectiveDecision {
  const closure = assessPostVerificationClosure({
    hasVerifiedBuild: input.hasVerifiedBuild,
    milestones: input.milestones,
    deliverableStatusOf: input.deliverableStatusOf,
  })
  const closureDirective = buildClosureDirective(closure)
  if (closureDirective) {
    return { kind: 'session_closure', blockDirective: closureDirective, closureStepDirective: null }
  }

  if (!input.hasVerifiedBuild && input.undeclaredDependencies.length > 0) {
    // Split by what this session has already learned. Ordering an install that has already
    // failed is not a directive, it is a loop with a preamble.
    const alreadyFailed = new Set(input.packagesWithFailedInstall)
    const installable = input.undeclaredDependencies.filter((u) => !alreadyFailed.has(u.packageName))
    const uninstallable = input.undeclaredDependencies.filter((u) => alreadyFailed.has(u.packageName))

    // Installable ones first: they are one command away, and the file rewrite the others need
    // is the more expensive instruction. One message still carries one instruction.
    if (installable.length > 0) {
      return {
        kind: 'dependencies_undeclared',
        blockDirective: buildUndeclaredDependencyDirective(installable),
        closureStepDirective: null,
      }
    }

    return {
      kind: 'dependencies_uninstallable',
      blockDirective: buildUninstallablePackageDirective(uninstallable),
      closureStepDirective: null,
      // The files that import the package which cannot be installed: exactly the files this
      // directive orders rewritten, and therefore exactly the ones the model must be able to see.
      rewriteTargets: Array.from(new Set(uninstallable.flatMap((u) => u.importedBy))),
    }
  }

  if (!input.hasVerifiedBuild && input.missingDependencies.length > 0) {
    return {
      kind: 'dependencies_missing',
      blockDirective: buildDependencyInstallDirective(input.missingDependencies),
      closureStepDirective: null,
    }
  }

  // Ahead of the check, and of closure, because a green check on a page that loads nothing is the inflated number this whole ordering exists to stop producing: on 2026-08-25 `tsc` passed over every file and the plan read 14/15 while `vite build` emitted no JavaScr
  if (!input.hasVerifiedBuild && input.disconnectedEntrypoint) {
    return {
      kind: 'entrypoint_disconnected',
      blockDirective: buildEntrypointDirective(
        input.disconnectedEntrypoint.htmlPath,
        input.disconnectedEntrypoint.expectedEntry
      ),
      closureStepDirective: null,
    }
  }

  if (!input.hasVerifiedBuild && input.verificationCommand && isEveryDeliverableSatisfied(input)) {
    // The check has run and failed, and nothing has changed since: ordering it again is ordering the model to re-read code it has already been told is wrong — and it was doing exactly that from the one channel that always wins, against a tool result telling it the o
    if (input.verificationFailing) {
      return {
        kind: 'verification_failing',
        blockDirective: buildVerificationFailingDirective(
          input.verificationCommand.command,
          input.verificationFailureDirective ?? null
        ),
        closureStepDirective: null,
        // The model rewrites this file next. Nine live runs show it never reads one first, so
        // showing it is the difference between an edit and a blind replacement.
        rewriteTargets: input.verificationFailureTargetFile ? [input.verificationFailureTargetFile] : undefined,
        requiredTools: input.verificationFailureTools?.length ? input.verificationFailureTools : undefined,
      }
    }

    return {
      kind: 'verification_due',
      blockDirective: buildVerificationDueDirective(input.verificationCommand),
      closureStepDirective: null,
    }
  }

  if (
    input.activeMilestone &&
    !isCompletionMilestoneTitle(input.activeMilestone) &&
    shouldDirectUnprovableClosure(input.activeMilestone, input.deliverableStatusOf(input.activeMilestone))
  ) {
    return {
      kind: 'unprovable_milestone',
      blockDirective: null,
      closureStepDirective: buildUnprovableMilestoneDirective(input.activeMilestone),
    }
  }

  return FOCUS
}

/** True when no open milestone is still owed a file. */
function isEveryDeliverableSatisfied(input: PlanDirectiveInput): boolean {
  const open = selectOpenMilestones(input.milestones)
  if (open.length === 0) return false
  return open.every((m) => input.deliverableStatusOf(m) !== 'unsatisfied')
}
