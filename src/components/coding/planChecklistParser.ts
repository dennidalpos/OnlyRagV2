import type { AgentPlan } from '../../hooks/usePlanApproval'

export interface PlanChecklistItem {
  id: string
  title: string
  completed: boolean
  status?: 'pending' | 'in_progress' | 'verified' | 'failed'
  tag?: string
}

/**
 * Derives checklist items directly from the canonical interventions.
 */
export function parsePlanChecklist(plan: Pick<AgentPlan, 'milestones'> | null | undefined): PlanChecklistItem[] {
  if (plan?.milestones.length) {
    return plan.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      completed: m.status === 'verified',
      status: m.status,
    }))
  }

  return []
}
