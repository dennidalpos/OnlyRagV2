/** Selects one plan directive per turn from caller-supplied workspace facts. */

import { isCompletionMilestoneTitle } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { MilestoneDeliverableStatus } from '../../../../shared/domain/agent/milestoneDeliverableResolver'
import { assessPostVerificationClosure, buildClosureDirective } from './postVerificationClosure'
import { shouldDirectUnprovableClosure, buildUnprovableMilestoneDirective } from './unprovableMilestoneDirective'
import { buildVerificationFailingDirective } from './verificationAttemptTracker'
import { buildEntrypointDirective } from './entrypointIntegrity'
import {
  BEHAVIOR_TEST_COMMAND,
  buildBehaviorTestRunnerInstallDirective,
  buildBehaviorTestScriptDirective,
  isUsableTestScript,
  resolveBehaviorTestRunner,
  selectOpenBehaviorMilestone,
} from './behaviorTestDirective'
import type { SupportedToolName } from './agentTypes'
import type { PackageImportStatement } from './importDeclarationGate'
import { renderOrder, type DiagnosticAdvice } from './diagnosticAdvice'

export type PlanDirectiveKind =
  | 'user_first_command'
  | 'session_closure'
  | 'dependencies_undeclared'
  | 'dependencies_uninstallable'
  | 'dependencies_unpublished'
  | 'dependencies_missing'
  | 'verification_due'
  | 'behavior_test_runner_missing'
  | 'behavior_test_script_missing'
  | 'verification_failing'
  | 'entrypoint_disconnected'
  | 'unprovable_milestone'
  | 'focus'

export interface PlanDirectiveDecision {
  kind: PlanDirectiveKind
  /** Replaces entire active focus block when present. */
  blockDirective: string | null
  /** Replaces directive 2 inside focus block. */
  closureStepDirective: string | null
  /** Target workspace files to rewrite. */
  rewriteTargets?: readonly string[]
  /** Required tools beyond standard edit. */
  requiredTools?: readonly SupportedToolName[]
}

/** Imported package not declared in package.json. */
export interface UndeclaredDependency {
  packageName: string
  importedBy: readonly string[]
}

export interface PlanDirectiveInput {
  /** The command the user required as the first action, on the first turn only (see extractUserMandatedFirstCommand). */
  userMandatedFirstCommand?: string | null
  hasVerifiedBuild: boolean
  milestones: readonly PlanMilestone[]
  activeMilestone: PlanMilestone | undefined
  deliverableStatusOf: (milestone: PlanMilestone) => MilestoneDeliverableStatus
  /** Packages declared in manifest but missing from node_modules. */
  missingDependencies: readonly string[]
  /** Imported packages not declared in manifest. */
  undeclaredDependencies: readonly UndeclaredDependency[]
  /** Packages whose installation already failed. */
  packagesWithFailedInstall: readonly string[]
  /** Pending package.json rewrite from dependency checks. */
  pendingManifestAdvice?: DiagnosticAdvice | null
  importStatementsOf?: (file: string, packageName: string) => readonly PackageImportStatement[]
  verificationCommand: { command: string; source: string } | null
  verificationFailing: boolean
  /** Fix diagnosed from the last failing verification; the arbiter alone turns it into an order. */
  verificationFailureAdvice?: DiagnosticAdvice | null
  /** The file that fix writes, so the prompt can carry its current content. */
  verificationFailureTargetFile?: string | null
  /** Tools beyond the file edit that the failure fix needs. */
  verificationFailureTools?: readonly SupportedToolName[]
  /**
   * The project's HTML entry page loads none of its own code. Null when the project has no
   * such page or the question does not apply. See entrypointIntegrity.ts.
   */
  disconnectedEntrypoint: { htmlPath: string; expectedEntry: string } | null
  /**
   * The package.json "test" script body: null when the manifest declares none, undefined when the
   * workspace has no package.json and the question does not apply.
   */
  packageTestScript?: string | null
  /** Every dependency and dev dependency package.json declares. */
  declaredPackages?: readonly string[]
  /** `npm test` has already run, failed, and nothing has been written since. */
  behaviorVerificationFailing?: boolean
  /** The fix diagnosed from that failing `npm test`, carried like `verificationFailureAdvice`. */
  behaviorFailureAdvice?: DiagnosticAdvice | null
  /** The file that fix writes. */
  behaviorFailureTargetFile?: string | null
  /** Tools that fix needs beyond the file edit, carried like `verificationFailureTools`. */
  behaviorFailureTools?: readonly SupportedToolName[]
}

const FOCUS: PlanDirectiveDecision = { kind: 'focus', blockDirective: null, closureStepDirective: null }

/** Open milestones: the completion one belongs to `finish`, and `failed` was abandoned on purpose. */
function selectOpenMilestones(milestones: readonly PlanMilestone[]): PlanMilestone[] {
  return milestones.filter((m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m))
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

/** The command a task written as "Run exactly `<command>` first" requires, on the first turn only. */
export function extractUserMandatedFirstCommand(userTask: string, isFirstTurn: boolean): string | null {
  if (!isFirstTurn) return null
  return userTask.match(/\bRun exactly\s+`([^`]+)`\s+first\b/i)?.[1] ?? null
}

/**
 * The highest-priority decision: the user's explicit first command outranks every plan heuristic,
 * and as the turn's one directive it no longer reaches the model next to a second order (a
 * dependencies_missing install or the focus block's directives).
 */
export function userFirstCommandDecision(command: string): PlanDirectiveDecision {
  return {
    kind: 'user_first_command',
    blockDirective: [
      `[USER-MANDATED FIRST COMMAND]`,
      `The user explicitly required this command as the first action: ${command}`,
      `Directives:`,
      `1. Your next tool call MUST be "run_command" with the command: ${command}`,
      `2. Do NOT run a build, edit a file, or call any other tool before it.`,
    ].join('\n'),
    closureStepDirective: null,
    requiredTools: ['run_command'],
  }
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
export function buildUninstallablePackageDirective(
  undeclared: readonly UndeclaredDependency[],
  /** The verbatim import statements of that package in that file, when the caller can read them. */
  importStatementsOf?: (file: string, packageName: string) => readonly PackageImportStatement[],
): string {
  // Pin one deterministic target until resolved to prevent target oscillation across turns.
  const ordered = [...undeclared].sort((a, b) => a.packageName.localeCompare(b.packageName))
  const target = ordered[0]
  const file = [...target.importedBy].sort()[0]
  const others = ordered.length - 1
  const imports = importStatementsOf?.(file, target.packageName) ?? []
  const names = Array.from(new Set(imports.flatMap((i) => i.boundNames)))

  return [
    `[THIS PACKAGE CANNOT BE INSTALLED — STOP TRYING]`,
    `You have run the install for "${target.packageName}" more than once in this session and it failed every time, including after any version conflict was resolved. Whatever the registry is answering, it is not going to change on another attempt.`,
    `The file that imports it is the thing to change now, not the command.`,
    ...(others > 0
      ? [
          `${others} other import${others === 1 ? '' : 's'} in this project ${others === 1 ? 'has' : 'have'} the same problem. ${others === 1 ? 'It is' : 'They are'} handled one at a time, after this one; this turn is about "${file}" only.`,
        ]
      : []),
    // A small model told to "rewrite so nothing imports X" re-emitted the same file, import
    // included, for 30 steps (full-task run 3, 2026-09-24): naming the exact lines to delete
    // and the names to replace turns the order into an edit it can check.
    ...(imports.length > 0
      ? [
          `Delete ${imports.length === 1 ? 'this line' : 'these lines'} from "${file}":`,
          ...imports.map((i) => `    ${i.statement.replace(/\s*\n\s*/g, ' ')}`),
          ...(names.length > 0
            ? [`Then replace every use of ${names.map((n) => `"${n}"`).join(', ')} in that file with plain HTML elements or code the project already declares.`]
            : []),
        ]
      : []),
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "${file}", with the complete file rewritten so that nothing in it imports "${target.packageName}", using only packages package.json already declares, and keeping the rest of the file's content intact. A file that still contains "${target.packageName}" does not satisfy this, however much the rest of it changed.`,
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
  if (input.userMandatedFirstCommand) return userFirstCommandDecision(input.userMandatedFirstCommand)

  const closure = assessPostVerificationClosure({
    hasVerifiedBuild: input.hasVerifiedBuild,
    milestones: input.milestones,
    deliverableStatusOf: input.deliverableStatusOf,
  })
  const closureDirective = buildClosureDirective(closure)
  if (closureDirective) {
    return { kind: 'session_closure', blockDirective: closureDirective, closureStepDirective: null }
  }

  // Ahead of every install: while package.json names what npm does not publish, each install
  // fails the same way, and ordering one spends the execution budget on a known failure.
  if (!input.hasVerifiedBuild && input.pendingManifestAdvice) {
    return {
      kind: 'dependencies_unpublished',
      blockDirective: renderOrder(input.pendingManifestAdvice),
      closureStepDirective: null,
      rewriteTargets: ['package.json'],
    }
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
      blockDirective: buildUninstallablePackageDirective(uninstallable, input.importStatementsOf),
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
      blockDirective: buildEntrypointDirective(input.disconnectedEntrypoint.htmlPath, input.disconnectedEntrypoint.expectedEntry),
      closureStepDirective: null,
    }
  }

  // A check that failed with a concrete diagnostic and nothing written since is fixed first, even
  // while later milestones still owe files: otherwise the turn policy withheld the tool that
  // diagnostic ordered (move_file for JSX in a .js file, full-task run 10 of 2026-09-24).
  if (
    !input.hasVerifiedBuild &&
    input.verificationCommand &&
    input.verificationFailing &&
    input.verificationFailureAdvice &&
    !isEveryDeliverableSatisfied(input)
  ) {
    return {
      kind: 'verification_failing',
      blockDirective: buildVerificationFailingDirective(input.verificationCommand.command, input.verificationFailureAdvice),
      closureStepDirective: null,
      rewriteTargets: input.verificationFailureTargetFile ? [input.verificationFailureTargetFile] : undefined,
      requiredTools: input.verificationFailureTools?.length ? input.verificationFailureTools : undefined,
    }
  }

  const behaviorDecision = resolveBehaviorTestDirective(input)
  if (behaviorDecision) return behaviorDecision

  if (!input.hasVerifiedBuild && input.verificationCommand && isEveryDeliverableSatisfied(input)) {
    // The check has run and failed, and nothing has changed since: ordering it again is ordering the model to re-read code it has already been told is wrong — and it was doing exactly that from the one channel that always wins, against a tool result telling it the o
    if (input.verificationFailing) {
      return {
        kind: 'verification_failing',
        blockDirective: buildVerificationFailingDirective(input.verificationCommand.command, input.verificationFailureAdvice ?? null),
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

/**
 * A milestone that promises behavior is proven only by `npm test`, and a build never promotes it
 * (milestoneVerificationPromotion.ts). On 2026-09-24 the full-task run verified 9/11 because
 * package.json never got a "test" script and no directive ever asked for one: these name the
 * missing runner, then the missing script, then the command itself once the build has passed.
 */
function resolveBehaviorTestDirective(input: PlanDirectiveInput): PlanDirectiveDecision | null {
  if (input.packageTestScript === undefined || !isEveryDeliverableSatisfied(input)) return null
  const milestone = selectOpenBehaviorMilestone(input.milestones)
  if (!milestone) return null

  const runner = resolveBehaviorTestRunner(milestone)
  if (!isUsableTestScript(input.packageTestScript, input.declaredPackages)) {
    if (runner.devPackage && !(input.declaredPackages ?? []).includes(runner.devPackage)) {
      return { kind: 'behavior_test_runner_missing', blockDirective: buildBehaviorTestRunnerInstallDirective(milestone, runner), closureStepDirective: null }
    }
    return {
      kind: 'behavior_test_script_missing',
      blockDirective: buildBehaviorTestScriptDirective(milestone, runner, input.packageTestScript, input.declaredPackages),
      closureStepDirective: null,
      rewriteTargets: ['package.json'],
    }
  }

  // Before the build has passed, the project's own check still comes first (verification_due).
  if (!input.hasVerifiedBuild && input.verificationCommand) return null
  if (input.behaviorVerificationFailing) {
    return {
      kind: 'verification_failing',
      blockDirective: buildVerificationFailingDirective(BEHAVIOR_TEST_COMMAND, input.behaviorFailureAdvice ?? null),
      closureStepDirective: null,
      rewriteTargets: input.behaviorFailureTargetFile ? [input.behaviorFailureTargetFile] : undefined,
      // Without it a move_file the directive ordered was denied by the turn policy, 30 steps in a row (live full task run 28, 2026-09-25).
      requiredTools: input.behaviorFailureTools?.length ? input.behaviorFailureTools : undefined,
    }
  }
  return {
    kind: 'verification_due',
    blockDirective: buildVerificationDueDirective({
      command: BEHAVIOR_TEST_COMMAND,
      source: `package.json script "test"; milestone ${milestone.id} promises behavior that a build cannot prove`,
    }),
    closureStepDirective: null,
  }
}

/** True when no open milestone is still owed a file. */
function isEveryDeliverableSatisfied(input: PlanDirectiveInput): boolean {
  const open = selectOpenMilestones(input.milestones)
  if (open.length === 0) return false
  return open.every((m) => input.deliverableStatusOf(m) !== 'unsatisfied')
}
