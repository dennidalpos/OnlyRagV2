import { extractDeliverablePaths, AWAITING_VERIFICATION_MARKER } from './milestoneDeliverableResolver'
import { selectPromptMilestoneWindow } from './planPromptWindow'
import { buildActiveInterventionActions } from './activeInterventionActions'
import type { PlanMilestone } from './planMilestone'

export type { PlanMilestone } from './planMilestone'

export interface CompactPlanState {
  objective: string
  restorePoint: string
  activeMicroTask: string
  pendingMicroTasks: string[]
  completedCount: number
  totalCount: number
  isCompleted: boolean
}

/**
 * Recognises persisted legacy closing milestones so they are not treated as outstanding work.
 * Canonical v2 plans do not create these entries; the application owns session closure.
 */
export function isCompletionMilestoneTitle(input: string | Pick<PlanMilestone, 'title' | 'filePaths'>): boolean {
  const title = typeof input === 'string' ? input : input.title
  if (typeof input !== 'string' && input.filePaths?.length) return false
  if (!/finish|completamento|arresto|riepilogo|final report/i.test(title || '')) return false
  return extractDeliverablePaths(title || '').length === 0
}

export interface MilestoneTransition {
  id: string
  title: string
  from: PlanMilestone['status']
  to: PlanMilestone['status']
  cause: string
}

export class GoalDecompositionPlanner {
  private milestones: PlanMilestone[] = []
  private transitionListener?: (transition: MilestoneTransition) => void

  public onMilestoneTransition(listener: (transition: MilestoneTransition) => void): void {
    this.transitionListener = listener
  }

  public initializePlan(milestones: PlanMilestone[]): void {
    this.milestones = milestones.map((milestone, index) => ({
      ...milestone,
      id: milestone.id || `milestone-${index + 1}`,
      status: milestone.status || 'pending',
    }))
  }

  public loadMilestones(milestones: PlanMilestone[]): void {
    this.milestones = milestones ? [...milestones] : []
  }

  public getMilestones(): ReadonlyArray<PlanMilestone> {
    return this.milestones
  }

  public hasPlan(): boolean {
    return this.milestones.length > 0
  }

  public getActiveMilestone(isDeliverableSatisfied?: (milestone: PlanMilestone) => boolean): PlanMilestone | undefined {
    const inProgressUnsatisfied = this.milestones.find((milestone) => {
      if (milestone.status !== 'in_progress' || isCompletionMilestoneTitle(milestone)) return false
      if (isDeliverableSatisfied) return !isDeliverableSatisfied(milestone)
      return !milestone.notes?.includes(AWAITING_VERIFICATION_MARKER)
    })
    if (inProgressUnsatisfied) return inProgressUnsatisfied

    const nextPending = this.milestones.find(
      (milestone) => milestone.status === 'pending' && !isCompletionMilestoneTitle(milestone)
    )
    if (nextPending) return nextPending

    const anyInProgress = this.milestones.find(
      (milestone) => milestone.status === 'in_progress' && !isCompletionMilestoneTitle(milestone)
    )
    if (anyInProgress) return anyInProgress

    return this.milestones.find((milestone) => milestone.status === 'pending' || milestone.status === 'in_progress')
  }

  public findMilestone(idOrIndex: string | number): PlanMilestone | undefined {
    if (typeof idOrIndex === 'number') return this.milestones[idOrIndex]
    return this.milestones.find(
      (milestone) => milestone.id === idOrIndex || milestone.title.toLowerCase().includes(idOrIndex.toLowerCase())
    )
  }

  public updateMilestone(idOrIndex: string | number, status: PlanMilestone['status'], notes?: string): boolean {
    const target = this.findMilestone(idOrIndex)
    if (!target) return false

    const previousStatus = target.status
    target.status = status
    if (notes) target.notes = notes
    if (previousStatus !== status) {
      this.transitionListener?.({
        id: target.id,
        title: target.title,
        from: previousStatus,
        to: status,
        cause: notes || target.notes || 'No cause recorded.',
      })
    }
    return true
  }

  public isAllVerified(): boolean {
    return this.milestones.length > 0 && this.milestones.every((milestone) => milestone.status === 'verified')
  }

  public getProgressSummary(): { completed: number; total: number; percentage: number } {
    const total = this.milestones.length
    if (total === 0) return { completed: 0, total: 0, percentage: 0 }
    const completed = this.milestones.filter((milestone) => milestone.status === 'verified').length
    return { completed, total, percentage: Math.round((completed / total) * 100) }
  }

  public getCompactState(customObjective?: string): CompactPlanState {
    return GoalDecompositionPlanner.getCompactStateFromMilestones(this.milestones, customObjective)
  }

  public static getCompactStateFromMilestones(
    milestones: ReadonlyArray<PlanMilestone>,
    customObjective?: string
  ): CompactPlanState {
    const completedMilestones = milestones.filter((milestone) => milestone.status === 'verified')
    const pendingMilestones = milestones.filter((milestone) => milestone.status !== 'verified')
    const lastCompleted = completedMilestones.at(-1)
    const activeMilestone = pendingMilestones[0]

    return {
      objective: customObjective || 'Execution Plan',
      restorePoint: lastCompleted ? `${lastCompleted.id}: ${lastCompleted.title}` : 'None (Session Initialized)',
      activeMicroTask: activeMilestone ? `${activeMilestone.id}: ${activeMilestone.title}` : 'None (Plan Completed)',
      pendingMicroTasks: pendingMilestones.map((milestone) => `${milestone.id}: ${milestone.title}`),
      completedCount: completedMilestones.length,
      totalCount: milestones.length,
      isCompleted: milestones.length > 0 && pendingMilestones.length === 0,
    }
  }

  public compileProgressPrompt(context?: {
    directive?: { blockDirective?: string | null; closureStepDirective?: string | null } | null
  }): string {
    if (this.milestones.length === 0) return ''
    const blockDirective = context?.directive?.blockDirective
    const progress = this.getProgressSummary()
    const lines = [
      `### STRUCTURED EXECUTION PLAN (${progress.completed}/${progress.total} verified - ${progress.percentage}%)`,
      'Execute systematically. Mark milestones verified only when validated.',
    ]

    const activeMilestone = this.getActiveMilestone()
    const promptWindow = selectPromptMilestoneWindow(this.milestones, activeMilestone?.id)
    if (promptWindow.omittedBefore > 0) {
      lines.push(`[${promptWindow.omittedBefore} earlier milestones omitted from this turn; retained in canonical state.]`)
    }

    for (const { milestone, planIndex } of promptWindow.entries) {
      const icon = milestone.status === 'verified'
        ? '[x]'
        : milestone.status === 'in_progress'
          ? '[>]'
          : milestone.status === 'failed'
            ? '[!]'
            : '[ ]'
      let line = `${planIndex + 1}. ${icon} **${milestone.id}: ${milestone.title}**`
      if (milestone.filePaths?.length) {
        line += ` — *Files:* ${milestone.filePaths.map((filePath) => `\`${filePath}\``).join(', ')}`
      }
      if (milestone.acceptanceCriteria?.length) line += ` — *Criteria:* ${milestone.acceptanceCriteria.join('; ')}`
      if (milestone.falsifiableHypothesis) line += ` — *Hypothesis:* ${milestone.falsifiableHypothesis}`
      if (milestone.verificationCommand) line += ` — *Verify with:* \`${milestone.verificationCommand}\``
      if (milestone.notes) line += ` (Note: ${milestone.notes})`
      lines.push(line)
      if (milestone.id === activeMilestone?.id) {
        buildActiveInterventionActions(milestone).forEach((action, index) => lines.push(`   Action ${index + 1}: ${action}`))
      }
    }

    if (promptWindow.omittedAfter > 0) {
      lines.push(`[${promptWindow.omittedAfter} later milestones omitted from this turn; retained in canonical state.]`)
    }

    const failedMilestones = this.milestones.filter((milestone) => milestone.status === 'failed')
    if (progress.completed === progress.total && progress.total > 0) {
      lines.push(
        '\n[ALL CHECKLIST MILESTONES COMPLETED - FINAL REPORT REQUIRED]\nAll operational checklist tasks are complete. DO NOT execute any more file edits or commands.\nReply with a comprehensive final report (in the user\'s language) detailing:\n1. Summary of Functional Changes\n2. List of Modified/Created Files\n3. Verification & Test Results\n4. Final Conclusion\nThe application will independently evaluate the evidence and close the session; no finish tool is required.'
      )
    } else if (!activeMilestone || isCompletionMilestoneTitle(activeMilestone)) {
      const failedList = failedMilestones.length > 0
        ? `\nThe following milestones were abandoned and MUST be reported as incomplete in your summary:\n${failedMilestones.map((milestone) => `- ${milestone.id}: ${milestone.title}`).join('\n')}`
        : ''
      lines.push(
        `\n[NO OPERATIONAL MILESTONES REMAIN - FINAL REPORT REQUIRED]\nEvery milestone that can still be worked on is either verified or abandoned. DO NOT execute any more file edits or commands, and DO NOT ask the user a question.\nReply with a comprehensive final report (in the user's language) detailing:\n1. Summary of Functional Changes\n2. List of Modified/Created Files\n3. Verification & Test Results\n4. Work left incomplete and why\n5. Final Conclusion\nThe application will independently evaluate the evidence and close the session; no finish tool is required.${failedList}`
      )
    } else if (blockDirective) {
      lines.push(`\n${blockDirective}`)
    } else {
      const closureStep =
        context?.directive?.closureStepDirective ||
        '2. Once the required files for this milestone are created or updated, invoke "update_plan" to mark it verified or proceed directly to the next milestone.'
      lines.push(
        [
          '\n[CURRENT ACTIVE MICRO-TASK FOCUS]',
          '🎯 ACTIVE MILESTONE (Focus on this step now):',
          `👉 **Task ${activeMilestone.id}: ${activeMilestone.title}**`,
          'Directives:',
          '1. Focus your actions on achieving the goals of this milestone.',
          closureStep,
          '3. Never repeat identical file writes or commands in a loop. If configuration or boilerplate files are already created, advance immediately to implementing components in src/.',
          '4. Do NOT invoke "finish" until all operational checklist milestones are completed and verified.',
          '5. If a scaffolding command fails or hangs, create only the files named by the active milestone; preserve the accepted stack and existing infrastructure.',
        ].join('\n')
      )
    }

    return lines.join('\n')
  }
}
