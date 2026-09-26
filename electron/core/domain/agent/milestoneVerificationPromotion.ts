/** Promotes only milestones with matching proof and satisfied deliverables. */

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
  deliverableStatusOf: (milestone: PlanMilestone) => MilestoneDeliverableStatus,
): PromotionCandidate[] {
  const executed = verificationCommand.trim().toLowerCase()
  return (
    milestones
      .filter((m) => m.status !== 'verified' && m.status !== 'failed')
      .filter((m) => !isCompletionMilestoneTitle(m))
      .filter((m) => !m.verificationCommand || m.verificationCommand.trim().toLowerCase() === executed)
      // A milestone that promises behavior (e.g. a smoke test run by `npm test`) is not proven by a
      // build: its test file existing next to a green build says nothing about the test passing.
      .filter((m) => !requiresBehaviorEvidence(m) || verificationEvidenceKind(verificationCommand) === 'behavior')
      .filter((m) => deliverableStatusOf(m) === 'satisfied')
      .map((m) => ({ id: m.id, title: m.title }))
  )
}

/** The milestone declares or proposes a test run: a build cannot prove it. */
export function requiresBehaviorEvidence(milestone: PlanMilestone): boolean {
  const declared = milestone.verificationCommand || milestone.proposedVerificationCommand
  return Boolean(declared) && verificationEvidenceKind(declared!) === 'behavior'
}

export function verificationEvidenceKind(verificationCommand: string): 'compilation' | 'behavior' {
  return /(^|[\s:&|])(test(?::\S+)?|pytest|vitest|jest|mocha)([\s:&|]|$)/i.test(verificationCommand) ? 'behavior' : 'compilation'
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

/** Names missing deliverables so the model does not rewrite completed files. */
export function partialDeliveryDirective(milestoneId: string, writtenPath: string, missingPaths: readonly string[]): string {
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
 * Note appended when a write touches a file of a milestone whose deliverables were already present.
 * Editing a delivered file is ordinary work (a build fix, a version bump the registry check asked
 * for), so this only states the plan facts; it never orders the model to stop editing.
 */
export function redeliveredMilestoneDirective(
  milestoneId: string,
  rewrittenPath: string,
  nextNeed: { milestoneId: string; missingPaths: readonly string[] } | null,
): string {
  const lines = [
    `[PLAN NOTE] "${rewrittenPath}" belongs to milestone ${milestoneId}, whose files were already on disk; the write was applied. Only a passing verification marks a milestone verified.`,
  ]
  if (nextNeed) {
    const list = nextNeed.missingPaths.map((p) => `"${p}"`).join(', ')
    lines.push(`The active milestone ${nextNeed.milestoneId} still needs ${list}, which ${nextNeed.missingPaths.length === 1 ? 'does' : 'do'} not exist yet.`)
  }
  return lines.join('\n')
}
