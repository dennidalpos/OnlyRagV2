/**
 * Milestone Update Authority.
 *
 * `update_plan` is the model's handle on plan progression, and it used to be absolute: any
 * status the model named was written straight through. A 7B model misreading its own history
 * therefore wrecked its own plan — in session-1787471833056-o5fk it marked m-4 `failed` with a
 * note copied verbatim out of an old loop-intervention message, and pushed m-5 back from
 * `verified` to `in_progress` while keeping the now-false "Auto-verified" note. Four of the
 * five milestones the run reported as failed had their deliverables sitting on disk.
 *
 * Evidence on disk outranks the model's self-report. This module decides which updates are
 * allowed to land; it stays pure, so the caller supplies the deliverable evidence.
 */

import type { MilestoneDeliverableStatus } from './milestoneDeliverableResolver'
import type { PlanMilestone } from './planAndSolveGraph'

/**
 * Marker opening the note of a milestone the loop guard took away from the model.
 *
 * `failed` has two very different origins and they must not be treated alike. A milestone that
 * failed its own verification command SHOULD be recoverable — the model fixes the code, runs
 * the check again, and it passes. A milestone the system ABANDONED must not be: the guard
 * told the model "stop working on it entirely" and moved the focus elsewhere precisely to
 * break a loop, and letting the model write `verified` back over it undoes the escape. In
 * session-1787497654743-4enx m-6 was abandoned at step 41 and reported verified at step 47.
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
}

/**
 * Rules the model cannot talk its way past:
 *
 *  - A no-op update is refused. Repeating the status a milestone already holds costs a full
 *    LLM round-trip and moves nothing; 13 of 45 steps in the observed session went this way.
 *  - A `verified` milestone is never demoted. Reverting it buys the model nothing — plan
 *    status gates no tool, so a milestone needing rework can simply be reworked — while
 *    letting it revert is precisely how the plan lost progress it had genuinely earned.
 *  - `failed` is refused while the milestone's deliverables exist with content. "I could not
 *    do it" is not credible about a file the run already wrote.
 *
 * Everything else applies. Notes are replaced rather than merged: a status change invalidates
 * whatever the previous status said about itself.
 */
export function resolveMilestoneUpdate(req: MilestoneUpdateRequest): MilestoneUpdateVerdict {
  const { current, requestedStatus, requestedNotes, deliverableStatus } = req

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

  return { kind: 'apply', status: requestedStatus, notes: requestedNotes }
}
