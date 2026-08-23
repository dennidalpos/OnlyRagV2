/**
 * Milestone Verification Promotion.
 *
 * Decides which milestones a passing verification run has actually proven.
 *
 * Writing a file used to be enough to mark its milestone `verified`. In
 * session-1787485700613-o3tx that closed eleven of fourteen milestones in 48 seconds and drove
 * the progress bar to 73% for a project with no entrypoint, three undeclared dependencies and
 * a UI built with a framework the task had not asked for. Presence of a file is evidence that
 * something was written, never that it works.
 *
 * A green build is different: it compiled the files that are on disk right now, so it attests
 * to all of them at once. That is the promotion this module selects — and only for milestones
 * that name an artefact the build could have compiled.
 *
 * Pure domain: the caller supplies the deliverable status of each milestone.
 */

import { isCompletionMilestoneTitle } from './planAndSolveGraph'
import type { PlanMilestone } from './planAndSolveGraph'
import type { MilestoneDeliverableStatus } from './milestoneDeliverableResolver'

export interface PromotionCandidate {
  id: string
  title: string
}

/**
 * Milestones a passing verification promotes to `verified`.
 *
 * Excluded, each for its own reason:
 *  - already `verified`  — nothing to do.
 *  - `failed`            — abandoned deliberately by the loop guard; a later green build does
 *                          not retroactively mean the work happened.
 *  - the completion one  — owned by the finish tool, or the plan reads 100% before the agent
 *                          has written its report.
 *  - `not_applicable`    — names no artefact ("ensure buttons are 44x44 px"). Nothing the build
 *                          compiled can speak for it either way, which is exactly why closing
 *                          these on a pass would be fabricating verification again.
 *  - `unsatisfied`       — its files are missing or hold placeholder content.
 */
export function selectMilestonesProvenByVerification(
  milestones: readonly PlanMilestone[],
  deliverableStatusOf: (milestone: PlanMilestone) => MilestoneDeliverableStatus
): PromotionCandidate[] {
  return milestones
    .filter((m) => m.status !== 'verified' && m.status !== 'failed')
    .filter((m) => !isCompletionMilestoneTitle(m.title))
    .filter((m) => deliverableStatusOf(m) === 'satisfied')
    .map((m) => ({ id: m.id, title: m.title }))
}

/** The note recorded on a milestone promoted this way, naming the command that proved it. */
export function promotionNote(verificationCommand: string): string {
  return `Verified: "${verificationCommand}" passed with every file this milestone names present on disk.`
}

/** The note recorded when a deliverable lands but nothing has verified it yet. */
export function awaitingVerificationNote(evidencePath: string): string {
  return `"${evidencePath}" was written for this milestone and every file it names is on disk. Awaiting a passing verification command before this can count as verified.`
}
