import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'

/** Replaces focus directive 2 when the active milestone names no artefact. */
export function buildUnprovableMilestoneDirective(milestone: Pick<PlanMilestone, 'id' | 'title'>): string {
  // "No command can prove it" has to be literally true, which is why the caller must have
  // ruled out a verificationCommand first — see shouldDirectUnprovableClosure.
  return [
    `2. THIS MILESTONE NAMES NO FILE. No write and no command can prove it, so it will stay open until you close it yourself — creating a new file will NOT satisfy it and will be blocked as a loop.`,
    `   Do the work it describes inside the files that already exist, then call "update_plan" with milestoneId "${milestone.id}" and status "verified", judging for yourself whether "${milestone.title}" is done.`,
  ].join('\n')
}

/** Whether the plan block should carry the directive above. */
export function shouldDirectUnprovableClosure(
  activeMilestone: Pick<PlanMilestone, 'id' | 'title' | 'verificationCommand'> | null | undefined,
  deliverableStatus: 'satisfied' | 'unsatisfied' | 'not_applicable',
): boolean {
  if (!activeMilestone || deliverableStatus !== 'not_applicable') return false
  return !activeMilestone.verificationCommand?.trim()
}
