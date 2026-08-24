import type { AgentPlan } from '../../hooks/usePlanApproval'
import { compilePlanFromText } from '../../../electron/core/domain/agent/planCompilation'

export interface PlanChecklistItem {
  id: string
  title: string
  completed: boolean
  status?: 'pending' | 'in_progress' | 'verified' | 'failed'
  tag?: string
}

/**
 * Parses structured checklist items from either pre-computed plan milestones
 * or by running the canonical GoalDecompositionPlanner parser over raw plan text.
 */
export function parsePlanChecklist(plan: Pick<AgentPlan, 'planText' | 'milestones'> | null | undefined): PlanChecklistItem[] {
  if (plan?.milestones && plan.milestones.length > 0) {
    return plan.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      completed: m.status === 'verified',
      status: m.status,
    }))
  }

  if (!plan?.planText || !plan.planText.trim()) return []

  const parsedMilestones = compilePlanFromText(plan.planText)
  return parsedMilestones.map((m) => ({
    id: m.id,
    title: m.title,
    completed: m.status === 'verified',
    status: m.status,
  }))
}
