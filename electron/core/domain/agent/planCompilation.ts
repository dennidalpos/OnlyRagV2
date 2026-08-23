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

/** Applies normalisation and capping to milestones that are already parsed. */
export function compilePlanMilestones(milestones: PlanMilestone[]): PlanMilestone[] {
  return capPlanMilestones(normalizePlanFalsifiability(milestones))
}

/** Parses raw model output into the canonical executable plan. */
export function compilePlanFromText(planText: string): PlanMilestone[] {
  return compilePlanMilestones(GoalDecompositionPlanner.parsePlanFromText(planText))
}
