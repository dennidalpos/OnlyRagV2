/**
 * Milestone Update Authority.
 * Evidence on disk outranks model self-report: prevents models from marking milestones
 * failed or demoting verified ones when deliverables exist on disk (see docs/code-rationales.md).
 */

import type { MilestoneDeliverableStatus } from '../../../../shared/domain/agent/milestoneDeliverableResolver'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'

/**
 * Marker opening the note of a milestone abandoned by the loop guard to break an infinite loop.
 * Abandoned milestones cannot be reopened or marked verified by the model.
 */
const ABANDONED_NOTE_PREFIX = 'Abandoned by the system'

/** The note recorded on a milestone the loop guard abandons, in the form isSystemAbandoned reads. */
export function abandonedMilestoneNote(blockedAttempts: number, target: string): string {
  return `${ABANDONED_NOTE_PREFIX} after ${blockedAttempts} consecutive blocked attempts on '${target}'.`
}

/** True for a milestone the loop guard abandoned, as opposed to one that failed a check. */
export function isSystemAbandoned(milestone: Pick<PlanMilestone, 'status' | 'notes'>): boolean {
  return milestone.status === 'failed' && (milestone.notes || '').startsWith(ABANDONED_NOTE_PREFIX)
}

export type MilestoneUpdateVerdict =
  | { kind: 'apply'; status: PlanMilestone['status']; notes: string | undefined }
  | { kind: 'reject'; reason: string; directive: string }

export interface MilestoneUpdateRequest {
  current: PlanMilestone
  requestedStatus: PlanMilestone['status']
  requestedNotes?: string
  /** Whether the files named by the milestone title are on disk (see milestoneDeliverableResolver). */
  deliverableStatus: MilestoneDeliverableStatus
  /**
   * Which of those files are missing, empty or placeholders. Only ever read to name them in a
   * refusal, so callers that cannot itemise may omit it and get a generic message.
   */
  unsatisfiedDeliverables?: readonly string[]
}

/**
 * Rules for milestone progression:
 * - Refuses no-op updates to save round-trips.
 * - Prevents demoting verified milestones.
 * - Rejects `failed` if deliverables exist with real content on disk.
 * - Rejects `verified` if deliverables are missing, empty, or placeholders.
 * - Replaces notes entirely on valid status change.
 */
export function resolveMilestoneUpdate(req: MilestoneUpdateRequest): MilestoneUpdateVerdict {
  const { current, requestedStatus, requestedNotes, deliverableStatus, unsatisfiedDeliverables } = req

  if (requestedStatus === current.status) {
    return {
      kind: 'reject',
      reason: `Milestone '${current.id}' is already ${current.status}`,
      directive: `[UPDATE_PLAN REJECTED: NO-OP] Milestone '${current.id}' is already '${current.status}'. Repeating an update that changes nothing wastes a step.\nExecute the milestone's actual work now with write_file, replace_file_content or run_command, or invoke "finish" if there is nothing left to do.`,
    }
  }

  if (current.status === 'verified') {
    return {
      kind: 'reject',
      reason: `Milestone '${current.id}' is already verified and cannot be reopened`,
      directive: `[UPDATE_PLAN REJECTED: ALREADY VERIFIED] Milestone '${current.id}' has been verified against the workspace and will not be reopened.\nYou do NOT need to reopen a milestone to change a file — edit the file directly. Move on to the current active milestone.`,
    }
  }

  if (isSystemAbandoned(current)) {
    return {
      kind: 'reject',
      reason: `Milestone '${current.id}' was abandoned by the loop guard and cannot be reopened`,
      directive: `[UPDATE_PLAN REJECTED: ABANDONED] Milestone '${current.id}' was abandoned by the system to break a loop, and stays abandoned — exactly as you were told when it happened.\nDo not report it, do not retry it. Execute your current active milestone instead, and describe what was left undone in your final report.`,
    }
  }

  if (requestedStatus === 'failed' && deliverableStatus === 'satisfied') {
    return {
      kind: 'reject',
      reason: `Milestone '${current.id}' cannot be failed: its deliverables exist on disk`,
      directive: `[UPDATE_PLAN REJECTED: CONTRADICTED BY THE WORKSPACE] Every file named by milestone '${current.id}' exists on disk with content, so it cannot be reported as failed.\nIf the content is wrong, fix the file with replace_file_content and mark the milestone verified. If it is already correct, move to the next milestone.`,
    }
  }

  if (requestedStatus === 'verified' && deliverableStatus === 'unsatisfied') {
    const named = (unsatisfiedDeliverables || []).filter(Boolean)
    const whichFiles = named.length
      ? `Still missing, empty or placeholder: ${named.join(', ')}.`
      : `At least one file this milestone names is missing, empty or still a placeholder.`
    return {
      kind: 'reject',
      reason: `Milestone '${current.id}' cannot be verified: ${named.length ? named.join(', ') : 'deliverables'} not on disk`,
      directive:
        `[UPDATE_PLAN REJECTED: DELIVERABLES MISSING] Milestone '${current.id}' names files it has not produced, so it cannot be verified — whatever its check reported.\n` +
        `${whichFiles}\n` +
        `Directives:\n` +
        `1. Write the missing file(s) with write_file, with real content — not a TODO comment.\n` +
        `2. Then mark this milestone again. A check that passes while a declared file is absent is proving something other than this milestone.`,
    }
  }

  return { kind: 'apply', status: requestedStatus, notes: requestedNotes }
}
