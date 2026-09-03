/**
 * Plan Compilation.
 *
 * Turning a model's checklist text into the plan the agent actually executes takes five
 * ordered passes, and every call site needs all five in the same order. They used to be
 * applied ad hoc — parsing everywhere, capping in most places, normalisation nowhere — which
 * is how the renderer, the plan-approval flow and the agent loop ended up able to disagree
 * about what the plan even was.
 *
 * The order is load-bearing:
 *  1. parse        — recognise the checklist structure (the canonical parser).
 *  2. normalise    — fold acceptance criteria into the deliverables they qualify, so every
 *                    surviving entry is something that can be shown done or not done.
 *  3. cap          — merge whatever still exceeds the plan length a small model can hold.
 *  4. ensure runnable  — append the project's own check as a milestone no write can close.
 *  5. ensure entrypoint — prepend the entry files a greenfield web plan never asks for.
 *
 * Normalising before capping matters: criteria folded away in step 2 are entries step 3 no
 * longer has to merge, so the cap spends its budget on real work instead of on requirements
 * that were never steps. Steps 4 and 5 run after the cap on purpose: what they add are the
 * entries the plan may never lose to a merge — the proof at the end, the entrypoint at the
 * start.
 */

import { GoalDecompositionPlanner, type PlanMilestone } from './planAndSolveGraph'
import { normalizePlanFalsifiability } from './planFalsifiabilityNormalizer'
import { capPlanMilestones } from './planMilestoneCapper'
import { isCompletionMilestoneTitle } from './planAndSolveGraph'
import { extractDeliverablePaths } from './milestoneDeliverableResolver'

/**
 * Appends the milestone a file-shaped plan can never contain: the project's own check passing.
 *
 * Ten of fifteen milestones in the observed plans say "create the file X", and a plan of that
 * shape reaches 100% by writing files. Measured on 2026-08-25: 14/15 verified, `tsc` green over
 * every file, and `vite build` emitting no JavaScript at all — every deliverable present, the
 * application dead. Nothing in the plan could contradict that, because nothing in the plan was
 * about the application working.
 *
 * Appended only when the project actually declares a check, and citing that command verbatim.
 * Inventing one would be the fabricated verification this codebase keeps removing, and the
 * planner prompt already forbids the model from doing exactly that.
 *
 * The entry names no file on purpose, so no write can close it: it closes when `update_plan`
 * runs its command and the command exits 0, or when a passing verification promotes it. It
 * carries a command, so the unprovable-milestone directive correctly leaves it alone.
 */
export function ensureRunnableMilestone(
  milestones: PlanMilestone[],
  verificationCommand?: string | null
): PlanMilestone[] {
  if (!verificationCommand) return milestones
  const alreadyProven = milestones.some((m) => m.verificationCommand === verificationCommand)
  if (alreadyProven) return milestones

  const operational = milestones.filter((m) => !isCompletionMilestoneTitle(m.title))
  const insertAt = operational.length
  const entry: PlanMilestone = {
    id: `m-${insertAt + 1}`,
    title: `Verify the application builds and runs end to end`,
    status: 'pending',
    verificationCommand,
    falsifiableHypothesis: `\`${verificationCommand}\` exits 0 over the project as it stands.`,
  }

  // Before the closing report milestone, which the finish tool owns.
  const closing = milestones.slice(insertAt)
  return [...milestones.slice(0, insertAt), entry, ...closing.map((m, i) => ({ ...m, id: `m-${insertAt + 2 + i}` }))]
}

/** What the workspace already provides, so this module never guesses at disk state. */
export interface WorkspaceScaffoldFacts {
  /** The workspace declares a manifest (package.json and friends). */
  hasManifest: boolean
  /** The workspace already carries an HTML entry page. */
  hasHtmlEntrypoint: boolean
}

/** A source file the bundler would have to reach: what makes a plan a web-app plan. */
const WEB_SOURCE_FILE = /\.(tsx|jsx|ts|js|mjs|css)$/i

/**
 * Prepends the entry files a greenfield web plan needs and never asks for.
 *
 * Measured twice on 2026-08-25, on the same probe, before and after strengthening the planner
 * prompt: the generated plan went straight to pages and components and named no `index.html`
 * and no `src/main.tsx`. Both runs spent fifty steps and twenty-four writes, ran zero builds,
 * and delivered a workspace with no entry page at all — so nothing could compile, and
 * `entrypointIntegrity` could not even fire, because it needs an HTML page to inspect.
 *
 * The prompt lever was tried twice and failed twice, and the reason is visible in the plans:
 * the user's own task text prescribes a folder layout, and the nearest most concrete
 * instruction wins. The knowledge that the workspace is empty is the app's, not the model's,
 * so the app supplies the step instead of asking for it — the same move `ensureRunnableMilestone`
 * makes for the project's own check.
 *
 * The rule for what belongs in the list, arrived at by getting it wrong twice: **exactly the
 * files without which the project's own declared check cannot pass.** Not "a scaffold", and not
 * "what Vite minimally needs" — that reasoning is what produced both mistakes.
 *
 * * `package.json` was left out first, on the reasoning that `npm install` would create it. Run
 *   three of 2026-08-25 then emitted **zero commands in fifty steps**, and a manifest-less
 *   workspace has no path to any command at all: `dependencies_missing` has nothing to compare,
 *   `verification_due` names a declared command and none is declared, and
 *   `ensureRunnableMilestone` appends nothing for the same reason.
 * * `tsconfig.json` was left out next, on the reasoning that a Vite build does not need one.
 *   True of Vite and false of the project: run four wrote `"build": "tsc && vite build"` into its
 *   own manifest, and `tsc` with no config and no inputs exits by printing its usage. `npx vite
 *   build` succeeded by hand on that same workspace — 38 modules, 180 kB of JavaScript — while
 *   the command the project declares could never pass.
 *
 * Deliberately narrow otherwise. It adds nothing when the workspace already has an entry page or
 * a manifest, and nothing at all when the plan names no web source file — a Python or Rust plan
 * must never be handed a `vite` skeleton. `vite.config.ts` stays out because nothing measured has
 * needed it: a default Vite build resolves the entry from a root `index.html`.
 *
 * Each entry is judged on its own, which run five had to teach. That plan named
 * `public/index.html`, and a single blanket "the plan mentions some HTML" check switched the
 * whole pass off — no `tsconfig.json`, no `src/main.tsx`, and a page in `public/` that a default
 * Vite build never treats as the entry. One misplaced file must not be able to cancel the other
 * three, so only a root-level `index.html` counts as the plan having covered the entry page.
 */
export function ensureEntrypointMilestones(
  milestones: PlanMilestone[],
  workspace?: WorkspaceScaffoldFacts | null
): PlanMilestone[] {
  if (!workspace || workspace.hasHtmlEntrypoint || workspace.hasManifest) return milestones

  const named = milestones.flatMap((m) => extractDeliverablePaths(m.title))
  if (!named.some((p) => WEB_SOURCE_FILE.test(p))) return milestones

  const missing: Array<{ title: string; path: string; falsifiableHypothesis?: string }> = [
    { title: 'The project declares its dependencies and its build script', path: 'package.json' },
    {
      title: 'TypeScript checks source without emitting JavaScript into src (`noEmit: true`)',
      path: 'tsconfig.json',
      // A generated `tsconfig` without noEmit made `tsc && vite build` scatter .js and .js.map
      // beside every source file. Vite owns production emission; this compiler pass is a check.
      falsifiableHypothesis: '`tsconfig.json` sets `compilerOptions.noEmit` to true.',
    },
    { title: 'The page loads the application entry script', path: 'index.html' },
    { title: 'The entry script mounts the root component into the page', path: 'src/main.tsx' },
  ].filter((entry) => !named.includes(entry.path))
  if (missing.length === 0) return milestones

  // Prepended, not appended: everything else in the plan is unreachable until these exist, and
  // the plan is executed in order. Like the runnable milestone, these are added after the cap —
  // they are the entries a merge must never be able to take away.
  const prepended: PlanMilestone[] = missing.map((entry) => ({
    id: '',
    title: `${entry.title} — \`${entry.path}\``,
    status: 'pending',
    falsifiableHypothesis: entry.falsifiableHypothesis,
  }))

  return [...prepended, ...milestones].map((m, idx) => ({ ...m, id: `m-${idx + 1}` }))
}

/** Applies normalisation and capping to milestones that are already parsed. */
export function compilePlanMilestones(
  milestones: PlanMilestone[],
  verificationCommand?: string | null,
  workspace?: WorkspaceScaffoldFacts | null
): PlanMilestone[] {
  const compiled = ensureRunnableMilestone(capPlanMilestones(normalizePlanFalsifiability(milestones)), verificationCommand)
  return ensureEntrypointMilestones(compiled, workspace)
}

/** Parses raw model output into the canonical executable plan. */
export function compilePlanFromText(
  planText: string,
  verificationCommand?: string | null,
  workspace?: WorkspaceScaffoldFacts | null
): PlanMilestone[] {
  return compilePlanMilestones(GoalDecompositionPlanner.parsePlanFromText(planText), verificationCommand, workspace)
}
