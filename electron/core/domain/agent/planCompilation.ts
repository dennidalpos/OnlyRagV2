/**
 * Plan Compilation.
 *
 * Turning a model's checklist text into the plan the agent actually executes takes three
 * ordered passes, and every call site needs all three in the same order. They used to be
 * applied ad hoc — parsing everywhere, capping in most places, normalisation nowhere — which
 * is how the renderer, the plan-approval flow and the agent loop ended up able to disagree
 * about what the plan even was.
 *
 * The order is load-bearing:
 *  1. parse        — recognise the checklist structure (the canonical parser).
 *  2. normalise    — fold acceptance criteria into the deliverables they qualify, so every
 *                    surviving entry is something that can be shown done or not done.
 *  3. cap          — merge whatever still exceeds the plan length a small model can hold.
 *
 * Normalising before capping matters: criteria folded away in step 2 are entries step 3 no
 * longer has to merge, so the cap spends its budget on real work instead of on requirements
 * that were never steps.
 */

import { GoalDecompositionPlanner, type PlanMilestone } from './planAndSolveGraph'
import { normalizePlanFalsifiability } from './planFalsifiabilityNormalizer'
import { capPlanMilestones } from './planMilestoneCapper'
import { isCompletionMilestoneTitle } from './planAndSolveGraph'

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

/** Applies normalisation and capping to milestones that are already parsed. */
export function compilePlanMilestones(milestones: PlanMilestone[], verificationCommand?: string | null): PlanMilestone[] {
  return ensureRunnableMilestone(capPlanMilestones(normalizePlanFalsifiability(milestones)), verificationCommand)
}

/** Parses raw model output into the canonical executable plan. */
export function compilePlanFromText(planText: string, verificationCommand?: string | null): PlanMilestone[] {
  return compilePlanMilestones(GoalDecompositionPlanner.parsePlanFromText(planText), verificationCommand)
}
