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

import { isCompletionMilestoneTitle } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import { AWAITING_VERIFICATION_MARKER } from '../../../../shared/domain/agent/milestoneDeliverableResolver'
import type { MilestoneDeliverableStatus } from '../../../../shared/domain/agent/milestoneDeliverableResolver'

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
  return `"${evidencePath}" was written for this milestone and every file it names is on disk. ${AWAITING_VERIFICATION_MARKER} before this can count as verified.`
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
 *
 * ## What this directive may NOT claim
 *
 * It said "it is already correct and re-writing it will be blocked as a loop". Neither half was
 * supported. The probe behind it (workspaceDeliverableProbe.ts) establishes that a file exists
 * and is not placeholder content — never that its content is CORRECT — and whether a rewrite is
 * blocked depends on the loop detector's window, not on this milestone.
 *
 * Both halves outlive their turn. This text is a tool result, so it is replayed inside the
 * history block for as long as it survives trimming, while the plan block above it is rebuilt
 * from live state every turn. In session live-full-task of 2026-08-25T12:11 the two ended up in
 * the same prompt saying opposite things: this directive (emitted at step 8) forbade rewriting
 * "src/pages/DashboardPage.tsx" and threatened a block, while the active plan block ordered
 * exactly that rewrite because the file imports a package that does not exist. The forbidding
 * text sat in the prompt for steps 9-20 and 24-28; the model did not touch that file once in
 * that window, and first rewrote it at step 43 — fifteen steps after the text aged out.
 *
 * So the rule this docstring exists to record: a directive states what was MEASURED and what to
 * do next. It does not certify content it never read, and it does not threaten a consequence
 * another subsystem owns. A stale certificate outranks a live instruction, because the model
 * cannot tell which of the two is older. See blueprint §6.2.3.
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
    `"${writtenPath}" is on disk with real content, so it is not what this milestone is still waiting on. Milestone ${milestoneId} also requires ${list}, which ${missingPaths.length === 1 ? 'is' : 'are'} NOT on disk (or holds placeholder content).`,
    `This milestone CANNOT be verified until every file it names exists with real content.`,
    `Directives:`,
    `1. Write ${list} next, rather than the file you have already delivered.`,
    `2. Then run this milestone's verification command, or mark it with update_plan.`,
  ].join('\n')
}

/**
 * What the model is told when it rewrites a milestone that was ALREADY complete.
 *
 * The third branch of the same fork, and the last one that said nothing. When a write lands
 * and the milestone's files are all present, `advanceActiveMilestoneOnMutation` records the
 * awaiting-verification note and logs a line — for the USER. Nothing reaches the model beyond
 * `Successfully wrote file`, which is indistinguishable from progress.
 *
 * Measured, live run of 2026-08-24: `src/main.tsx` was written at step 25 (m-5 complete), then
 * rewritten at steps 27, 28, 34 and 37 with DIFFERENT content every time — 617, 379, 368, 262
 * and 529 characters, and the 262-character one was a literal
 * `// TODO: Implement main application logic` written over working code. Not identical, so the
 * no-op detector correctly stayed silent; not partial, so the partial-delivery directive had
 * nothing to say. Meanwhile the focus block named m-7 (`tailwind.config.js`,
 * `postcss.config.js`), and neither of those files was ever written in the whole run.
 *
 * The message therefore does two things and no more: it says this milestone was already
 * complete BEFORE this write, so the rewrite moved nothing, and it names the file the active
 * milestone is actually waiting for. One concrete action, which is the property every
 * directive that got obeyed quickly has had.
 */
export function redeliveredMilestoneDirective(
  milestoneId: string,
  rewrittenPath: string,
  nextNeed: { milestoneId: string; missingPaths: readonly string[] } | null
): string {
  const lines = [
    `[MILESTONE ${milestoneId} WAS ALREADY COMPLETE — THIS REWRITE CHANGED NOTHING IN THE PLAN]`,
    `"${rewrittenPath}" was already on disk with real content before this write, and every file milestone ${milestoneId} names was already present. Rewriting it cannot advance the plan, and it cannot make ${milestoneId} verified either — only a passing verification can do that.`,
    `Directives:`,
  ]

  if (nextNeed) {
    const list = nextNeed.missingPaths.map((p) => `"${p}"`).join(', ')
    lines.push(
      `1. Stop editing "${rewrittenPath}". Write ${list} next: ${nextNeed.milestoneId} is the active milestone and ${nextNeed.missingPaths.length === 1 ? 'that file does' : 'those files do'} not exist yet.`,
      `2. Do not rewrite a file that is already correct in order to look busy. If you believe "${rewrittenPath}" is genuinely wrong, say what is wrong with it in your explanation before changing it.`
    )
  } else {
    lines.push(
      `1. Stop editing "${rewrittenPath}". Move to the next milestone in the checklist that is not yet verified.`,
      `2. Do not rewrite a file that is already correct in order to look busy.`
    )
  }

  return lines.join('\n')
}
