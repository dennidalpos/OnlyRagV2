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

/**
 * What the model is told when it delivers PART of a milestone.
 *
 * The sibling of `awaitingVerificationNote`, for the branch that had no message at all. When a
 * write lands and every file the milestone names is present, the run says so. When one is
 * still missing, the same code path knew exactly which — `findUnsatisfiedDeliverables` returns
 * them itemised — and said nothing.
 *
 * live-full-task, 2026-08-24: milestone m-6 was "Configure Tailwind CSS in `postcss.config.js`
 * and `tailwind.config.js`". The model wrote `postcss.config.js` at step 19, was told
 * "Successfully wrote file", and then rewrote that same file at steps 20, 21, 22, 23, 25, 27,
 * 28 and 29 — byte-identical every time, each one blocked. `tailwind.config.js` was never
 * written, in the whole fifty-step run. The model was not confused about what it had done; it
 * was never told what it still owed, so it kept re-delivering the half it remembered.
 *
 * The wording puts the missing file first and the completed one second, because the missing
 * one is the next action. It names the files rather than saying "deliverables are missing":
 * a model told something is missing will guess, and the guess it made here was to rewrite the
 * file it already had.
 */
export function partialDeliveryDirective(
  milestoneId: string,
  writtenPath: string,
  missingPaths: readonly string[]
): string {
  const list = missingPaths.map((p) => `"${p}"`).join(', ')
  const plural = missingPaths.length === 1 ? 'file' : 'files'

  return [
    `[MILESTONE ${milestoneId} IS NOT DONE YET: ${missingPaths.length} ${plural.toUpperCase()} STILL MISSING]`,
    `"${writtenPath}" was written and is accepted. Milestone ${milestoneId} also requires ${list}, which ${missingPaths.length === 1 ? 'is' : 'are'} NOT on disk (or holds placeholder content).`,
    `This milestone CANNOT be verified until every file it names exists with real content.`,
    `Directives:`,
    `1. Write ${list} next. Do NOT re-write "${writtenPath}" — it is already correct and re-writing it will be blocked as a loop.`,
    `2. Then run this milestone's verification command, or mark it with update_plan.`,
  ].join('\n')
}
