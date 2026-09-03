/**
 * Plan Milestone Capper.
 *
 * PLAN_SYSTEM_PROMPT asks the planner for 5–15 atomic microtasks, but nothing enforced it:
 * the observed session produced 21, and every extra milestone is a line the agent re-reads in
 * the STRUCTURED EXECUTION PLAN block on every single turn. Past roughly fifteen entries the
 * plan stops being a checklist a smaller model can hold and starts crowding out the trajectory
 * and tool-output history it actually needs to make the next decision.
 *
 * Overflow is merged, never dropped: consecutive milestones are folded into evenly sized
 * buckets, so every requirement the planner emitted still reaches the agent — just grouped.
 * The fold is deterministic and depends only on the milestone list, so the same plan yields
 * the same result for every model and every run.
 */

import { isCompletionMilestoneTitle, type PlanMilestone } from './planAndSolveGraph'

/** Upper bound on plan length, matching the 5–15 range PLAN_SYSTEM_PROMPT already declares. */
export const MAX_PLAN_MILESTONES = 15

/**
 * Collapses a group of consecutive milestones into the single status that honestly
 * describes it: verified only when every member is, failed the moment one is.
 */
function mergeStatus(group: PlanMilestone[]): PlanMilestone['status'] {
  if (group.some((m) => m.status === 'failed')) return 'failed'
  if (group.every((m) => m.status === 'verified')) return 'verified'
  if (group.some((m) => m.status === 'in_progress' || m.status === 'verified')) return 'in_progress'
  return 'pending'
}

function mergeGroup(group: PlanMilestone[], index: number): PlanMilestone {
  if (group.length === 1) return { ...group[0], id: `m-${index + 1}` }

  return {
    id: `m-${index + 1}`,
    title: group.map((m) => m.title.trim()).filter(Boolean).join('; '),
    status: mergeStatus(group),
    falsifiableHypothesis: group.find((m) => m.falsifiableHypothesis)?.falsifiableHypothesis,
    verificationCommand: group.find((m) => m.verificationCommand)?.verificationCommand,
    notes: group.map((m) => m.notes).filter(Boolean).join(' | ') || undefined,
  }
}

/**
 * Returns a plan of at most `maxMilestones` entries, re-numbered m-1..m-N.
 *
 * A trailing completion milestone ("write the final report and stop") is held out of the
 * merge and re-appended last: the finish tool addresses it by title, and folding it into a
 * bucket with implementation work would make the agent's closing step unrecognisable.
 */
export function capPlanMilestones(
  milestones: PlanMilestone[],
  maxMilestones: number = MAX_PLAN_MILESTONES
): PlanMilestone[] {
  if (!Array.isArray(milestones) || milestones.length === 0) return []
  const cap = Math.max(1, Math.floor(maxMilestones))
  if (milestones.length <= cap) return milestones

  const last = milestones[milestones.length - 1]
  const completionMilestone = isCompletionMilestoneTitle(last.title) ? last : null
  const workMilestones = completionMilestone ? milestones.slice(0, -1) : milestones

  const workCap = completionMilestone ? Math.max(1, cap - 1) : cap

  // Exactly `workCap` groups, sized to differ by at most one. A uniform ceil() bucket size
  // would merge more aggressively than the cap requires (20 milestones into 10 groups of 2
  // rather than the 14 the cap allows), needlessly blurring requirements together.
  const baseSize = Math.floor(workMilestones.length / workCap)
  const oversizedGroups = workMilestones.length % workCap

  const merged: PlanMilestone[] = []
  let cursor = 0
  for (let group = 0; group < workCap; group++) {
    const size = baseSize + (group < oversizedGroups ? 1 : 0)
    merged.push(mergeGroup(workMilestones.slice(cursor, cursor + size), merged.length))
    cursor += size
  }

  if (completionMilestone) {
    merged.push({ ...completionMilestone, id: `m-${merged.length + 1}` })
  }

  return merged
}
