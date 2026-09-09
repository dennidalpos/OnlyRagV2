import type { PlanMilestone } from './planMilestone'

export const MAX_PROMPT_MILESTONES = 1

export interface PromptMilestoneWindow {
  entries: Array<{ milestone: PlanMilestone; planIndex: number }>
  omittedBefore: number
  omittedAfter: number
}

/** Keeps the canonical plan intact while limiting the slice repeated in each model turn. */
export function selectPromptMilestoneWindow(
  milestones: readonly PlanMilestone[],
  activeMilestoneId?: string,
  limit: number = MAX_PROMPT_MILESTONES
): PromptMilestoneWindow {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { entries: [], omittedBefore: 0, omittedAfter: 0 }
  }

  const windowSize = Math.max(1, Math.floor(limit))
  if (milestones.length <= windowSize) {
    return {
      entries: milestones.map((milestone, planIndex) => ({ milestone, planIndex })),
      omittedBefore: 0,
      omittedAfter: 0,
    }
  }

  const activeIndex = milestones.findIndex((milestone) => milestone.id === activeMilestoneId)
  const anchor = activeIndex >= 0 ? activeIndex : milestones.length - 1
  const start = windowSize === 1
    ? anchor
    : Math.max(0, Math.min(anchor - 1, milestones.length - windowSize))
  const end = start + windowSize

  return {
    entries: milestones.slice(start, end).map((milestone, offset) => ({
      milestone,
      planIndex: start + offset,
    })),
    omittedBefore: start,
    omittedAfter: milestones.length - end,
  }
}
