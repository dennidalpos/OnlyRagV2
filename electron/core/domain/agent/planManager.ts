import type { PlanMilestone } from './planAndSolveGraph'

export interface CompactPlanState {
  objective: string
  restorePoint: string
  activeMicroTask: string
  pendingMicroTasks: string[]
  completedCount: number
  totalCount: number
  isCompleted: boolean
}

export class PlanManager {
  /**
   * Computes a compact plan state representation directly from
   * GoalDecompositionPlanner's PlanMilestone[] — the canonical in-memory plan
   * representation — without round-tripping through markdown serialization
   * and re-parsing, which was fragile (two independent formats/regexes had
   * to stay in sync by convention only).
   */
  public static getCompactStateFromMilestones(
    milestones: ReadonlyArray<PlanMilestone>,
    customObjective?: string
  ): CompactPlanState {
    const totalCount = milestones.length
    const completedMilestones = milestones.filter((m) => m.status === 'verified')
    const pendingMilestones = milestones.filter((m) => m.status !== 'verified')
    const completedCount = completedMilestones.length
    const isCompleted = totalCount > 0 && pendingMilestones.length === 0

    const lastCompleted = completedMilestones.length > 0 ? completedMilestones[completedMilestones.length - 1] : null
    const restorePoint = lastCompleted ? `${lastCompleted.id}: ${lastCompleted.title}` : 'None (Session Initialized)'

    const activeMilestone = pendingMilestones.length > 0 ? pendingMilestones[0] : null
    const activeMicroTask = activeMilestone ? `${activeMilestone.id}: ${activeMilestone.title}` : 'None (Plan Completed)'

    const pendingMicroTasks = pendingMilestones.map((m) => `${m.id}: ${m.title}`)

    return {
      objective: customObjective || 'Execution Plan',
      restorePoint,
      activeMicroTask,
      pendingMicroTasks,
      completedCount,
      totalCount,
      isCompleted,
    }
  }
}
