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
   * Generates formatted markdown for .assistant/SESSION_TRACKER.md adhering to compaction rules.
   */
  public static generateSessionTrackerMarkdown(state: CompactPlanState): string {
    const lines: string[] = [
      '# SESSION TRACKER',
      '',
      '## Objective',
      state.objective || 'General Execution Objective',
      '',
      '## Restore Point',
      state.restorePoint || 'None (Session Initialized)',
      '',
      '## Active Micro-Task',
      state.activeMicroTask || 'None (Plan Completed)',
      '',
      '## Remaining Micro-Tasks',
    ]

    if (state.pendingMicroTasks.length === 0) {
      lines.push('- None')
    } else {
      for (const task of state.pendingMicroTasks) {
        lines.push(`- [ ] ${task}`)
      }
    }

    lines.push(
      '',
      '---',
      "[STOP DIRECTIVE]: Upon completing the last micro-task, write the final summary into the .assistant\\SESSION_TRACKER.md file, clearing out the pending task list. Immediately after, halt any automatic execution and write in the chat: 'WAITING FOR COMMAND: Plan completed. State saved and compacted. Awaiting instructions.'. Stop strictly here."
    )

    return lines.join('\n')
  }

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
