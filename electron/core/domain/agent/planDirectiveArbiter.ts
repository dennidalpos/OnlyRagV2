/**
 * Plan Directive Arbiter.
 *
 * Decides the ONE directive the plan block carries this turn.
 *
 * The surveillance grew to roughly fifteen guards that all write into the same prompt, and
 * none of them decided what the model should read *now*: whoever appended last won. Three
 * contradictions surfaced in a single session — the closure directive under "advance to the
 * next unfinished step"; "no command can prove it" on a milestone that declared a verification
 * command; focus directive 2 promising that writing files would close a milestone that named
 * none. Each was fixed by replacing instead of appending, one at a time. This module is the
 * point that does the deciding once, so a fourth case has somewhere to be resolved instead of
 * somewhere to be discovered.
 *
 * It also supplies the state that was missing entirely. `hasVerifiedBuild` is raised only by
 * `run_command` / `run_tests`, or by the finish gate running the verification itself — and the
 * finish gate is unreachable while focus directive 4 forbids `finish` until every milestone is
 * verified, which only a passing verification can achieve. In three live runs of fifty steps
 * the model therefore never ran a single command: `write_file` was the only legal move it had.
 * `verification_due` names the project's own command as the next action, in the channel that
 * repeats every turn, before the model is looping rather than after.
 *
 * Pure domain: the caller supplies every fact from disk.
 */

import { isCompletionMilestoneTitle } from './planAndSolveGraph'
import type { PlanMilestone } from './planAndSolveGraph'
import type { MilestoneDeliverableStatus } from './milestoneDeliverableResolver'
import { assessPostVerificationClosure, buildClosureDirective } from './postVerificationClosure'
import { shouldDirectUnprovableClosure, buildUnprovableMilestoneDirective } from './unprovableMilestoneDirective'
import { buildVerificationFailingDirective } from './verificationAttemptTracker'
import { buildEntrypointDirective } from './entrypointIntegrity'

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
  /**
   * Replaces the ENTIRE active-milestone focus block when present.
   *
   * Whole-block replacement, never an extra paragraph: the focus block's own directives
   * ("achieve this milestone's goals", "do NOT invoke finish") contradict every decision above
   * `focus`, and a message carrying two instructions is answered by the first one.
   */
  blockDirective: string | null
  /** Replaces ONLY directive 2 inside the focus block; the rest of the block stands. */
  closureStepDirective: string | null
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
  /**
   * Packages this session already tried to install and failed on. Ordering the same install
   * again is what turned a correct directive into a thirteen-step loop; see
   * installCommandParser.ts.
   */
  packagesWithFailedInstall: readonly string[]
  /** The command the project itself offers to prove it works, or null when it offers none. */
  verificationCommand: { command: string; source: string } | null
  /**
   * The verification command has already run, failed, and nothing has been written since.
   * `hasVerifiedBuild` cannot express this: it is false both before the first run and after a
   * failure, and the right next action is opposite in the two. See verificationAttemptTracker.ts.
   */
  verificationFailing: boolean
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
    (m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m.title)
  )
}

/**
 * What the model is told when the project's dependencies are not on disk.
 *
 * Ordered ahead of the build deliberately. `npm run build` against a workspace with no
 * `node_modules` fails on "vite: not found" — an error that says nothing about the code and
 * that a small model routinely answers by rewriting `package.json`. Sending it at a command
 * that is guaranteed to fail is how a directive loses the model's trust in one step.
 *
 * One imperative, one command, no alternatives to weigh (see the ERESOLVE note in the
 * blueprint: a directive that offers a decision invites the model to delegate it).
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

/**
 * What the model is told when the code imports a package nobody declared.
 *
 * The failure this pre-empts, verbatim from the live run of 2026-08-24: `vite.config.ts`
 * imported `@vitejs/plugin-react`, `package.json` never declared it, and every `npm run build`
 * of the session died on `Cannot find module '@vitejs/plugin-react'`. The per-write gate
 * reported it 44 times, always as a note attached to something else; nothing ever made it the
 * next action.
 *
 * It names the importing file, because a small model told "a package is missing" will guess
 * which one — and the guess observed in this project was to rewrite a file that was fine.
 * `npm install <pkg>` is the single instruction: it both declares and installs, which is why
 * this state is ordered ahead of `dependencies_missing`.
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
 * What the model is told when the package it was sent to install cannot be installed.
 *
 * The escape of `buildUndeclaredDependencyDirective`, promoted from its second line to the
 * whole instruction. Live run of 2026-08-24: the model imported `@tailwindcss/react`, which
 * does not exist on npm; the install directive was correct, the install failed, and because the
 * directive is recomputed from disk each turn it ordered the identical command again — thirteen
 * steps. The way out was already written in it, as directive 2 under an imperative directive 1,
 * and a model follows the first one. Once the install has demonstrably failed there is only one
 * instruction left, so it is the only one printed.
 */
export function buildUninstallablePackageDirective(undeclared: readonly UndeclaredDependency[]): string {
  const shown = undeclared.slice(0, 6)
  const lines = shown.map(
    (u, i) => `${i + 1}. "${u.packageName}" — remove it from ${u.importedBy.slice(0, 3).join(', ')}`
  )

  return [
    `[THESE PACKAGES CANNOT BE INSTALLED — STOP TRYING]`,
    `You have run the install for ${shown.length === 1 ? 'this package' : 'these packages'} more than once in this session and it failed every time, including after any version conflict was resolved. Whatever the registry is answering, it is not going to change on another attempt.`,
    `The file that imports it is the thing to change now, not the command. A name that never resolves is usually one that was invented rather than looked up.`,
    `Directives:`,
    ...lines,
    `${shown.length + 1}. Rewrite ${shown.length === 1 ? 'that file' : 'those files'} using only packages package.json already declares. Do NOT run any install command for ${shown.length === 1 ? 'this name' : 'these names'} again.`,
  ].join('\n')
}

/**
 * What the model is told when every deliverable it owes is on disk and nothing has proven it.
 *
 * This is the directive whose absence stalled every run. The plan block is the only channel
 * that reaches the model on every turn; until now it named nothing but file actions, and the
 * one text that ever named a command lived inside a loop-guard intervention — which arrives
 * only once the model is already spinning, and was ignored seven times out of seven.
 *
 * The command is the project's own, resolved from its manifest. A model is not a reliable
 * source of build commands: a plan that says "Run `npm run build`" for a project that declares
 * no such script is a claim, not a capability.
 */
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

/**
 * The single directive for this turn, chosen by declared priority.
 *
 * The order is the whole contract, so it is stated once, here:
 *
 *  1. `session_closure` — the verification passed and nothing has been written since. Any
 *     lower directive would put the model back to work on a project already proven, which is
 *     what produced four consecutive re-runs of a green build.
 *  2. `dependencies_undeclared` — the code imports what nobody declared, so no install list and
 *     no build can resolve it. Ahead of `dependencies_missing` because `npm install <pkg>`
 *     both declares and installs, settling the two at once for those packages. Splits into
 *     `dependencies_uninstallable` for names this session has already failed to install:
 *     re-ordering that command is a loop, and the file that imports the name is what changes.
 *  3. `dependencies_missing` — a precondition of every check. Ordered above the check itself
 *     so the model is never sent at a command that cannot succeed.
 *  4. `verification_due` / `verification_failing` — no open milestone is missing a file and nothing has been verified.
 *     Writing is exhausted; only a command can move the plan.
 *  5. `unprovable_milestone` — the active milestone names no artefact, so the standing promise
 *     that writing its files will close it is false. Replaces that one sentence, not the block.
 *  6. `focus` — everything else. There is real work left that a file action can deliver.
 *
 * `session_closure` and `verification_due` are mutually exclusive by construction
 * (`hasVerifiedBuild` gates them in opposite directions), and the order is stated anyway: an
 * arbiter whose correctness depends on two branches never both matching is one refactor away
 * from being wrong silently.
 */
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
    }
  }

  if (!input.hasVerifiedBuild && input.missingDependencies.length > 0) {
    return {
      kind: 'dependencies_missing',
      blockDirective: buildDependencyInstallDirective(input.missingDependencies),
      closureStepDirective: null,
    }
  }

  // Ahead of the check, and of closure, because a green check on a page that loads nothing is
  // the inflated number this whole ordering exists to stop producing: on 2026-08-25 `tsc`
  // passed over every file and the plan read 14/15 while `vite build` emitted no JavaScript.
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
    // The check has run and failed, and nothing has changed since: ordering it again is
    // ordering the model to re-read code it has already been told is wrong — and it was doing
    // exactly that from the one channel that always wins, against a tool result telling it the
    // opposite. See verificationAttemptTracker.ts for the measurement.
    if (input.verificationFailing) {
      return {
        kind: 'verification_failing',
        blockDirective: buildVerificationFailingDirective(input.verificationCommand.command),
        closureStepDirective: null,
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
    !isCompletionMilestoneTitle(input.activeMilestone.title) &&
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
 * True when no open milestone is still owed a file.
 *
 * `not_applicable` counts as satisfied here and nowhere else in the codebase, and the reason is
 * specific to this question: a milestone naming no artefact cannot be advanced by writing, so
 * its presence never means "keep writing". It DOES still block session closure — that is
 * `assessPostVerificationClosure`'s judgement, made above and not repeated here.
 *
 * An empty plan is not "everything delivered": with no milestone there is nothing to attest,
 * and ordering a build would be a check on a workspace nobody has described.
 */
function isEveryDeliverableSatisfied(input: PlanDirectiveInput): boolean {
  const open = selectOpenMilestones(input.milestones)
  if (open.length === 0) return false
  return open.every((m) => input.deliverableStatusOf(m) !== 'unsatisfied')
}
