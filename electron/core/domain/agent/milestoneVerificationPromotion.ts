/**
 * Milestone Verification Promotion.
 * Decides which milestones a passing verification command has actually proven based on disk deliverables.
 * Prevents false verification on mere file presence without passing verification (see docs/code-rationales.md).
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
 * Excludes already verified, failed/abandoned, completion milestone, and unsatisfied deliverables.
 */
export function selectMilestonesProvenByVerification(
  milestones: readonly PlanMilestone[],
  verificationCommand: string,
  deliverableStatusOf: (milestone: PlanMilestone) => MilestoneDeliverableStatus
): PromotionCandidate[] {
  const executed = verificationCommand.trim().toLowerCase()
  return milestones
    .filter((m) => m.status !== 'verified' && m.status !== 'failed')
    .filter((m) => !isCompletionMilestoneTitle(m))
    .filter((m) => !m.verificationCommand || m.verificationCommand.trim().toLowerCase() === executed)
    .filter((m) => deliverableStatusOf(m) === 'satisfied')
    .map((m) => ({ id: m.id, title: m.title }))
}

export function verificationEvidenceKind(verificationCommand: string): 'compilation' | 'behavior' {
  return /(^|[\s:&|])(test(?::\S+)?|pytest|vitest|jest|mocha)([\s:&|]|$)/i.test(verificationCommand)
    ? 'behavior'
    : 'compilation'
}

/** Records command evidence separately from the artifact prerequisite. */
export function promotionNote(verificationCommand: string): string {
  const evidence = verificationEvidenceKind(verificationCommand) === 'behavior' ? 'Behavior' : 'Compilation'
  return `${evidence} evidence: "${verificationCommand}" passed; every declared artifact is also present.`
}

/** The note recorded when a deliverable lands but nothing has verified it yet. */
export function awaitingVerificationNote(evidencePath: string): string {
  return `Artifact present: "${evidencePath}" and every file this milestone names are on disk. ${AWAITING_VERIFICATION_MARKER}; presence alone proves neither compilation nor behavior.`
}

/**
 * Directive emitted when only part of a milestone's deliverables are present on disk.
 * Explicitly names missing files to direct the model to the next action rather than re-writing existing files.
 * Detailed live-run failure mode analysis preserved in docs/code-rationales.md.
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
 * Directive emitted when a write re-delivers an already complete milestone.
 * Directs model to the active milestone waiting for deliverables rather than rewriting completed files.
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
