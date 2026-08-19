import { AgentPlan } from '../../hooks/usePlanApproval'

export interface PlanChecklistItem {
  id: string
  title: string
  completed: boolean
  tag?: string
}

/**
 * Prefers the backend's canonical milestones (GoalDecompositionPlanner parser, the single
 * source of truth also used by the orchestrator loop) over local regex parsing. The regex
 * parser below only runs as a defensive fallback when canonical milestones are unavailable
 * (e.g. IPC not ready, or a plan cached in localStorage from before this field existed).
 */
export function parsePlanChecklist(plan: Pick<AgentPlan, 'planText' | 'milestones'> | null | undefined): PlanChecklistItem[] {
  if (plan?.milestones && plan.milestones.length > 0) {
    return plan.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      completed: m.status === 'verified',
    }))
  }

  if (!plan?.planText) return []

  const lines = plan.planText.split(/\r?\n/)
  const items: PlanChecklistItem[] = []
  let counter = 1

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Match markdown checklist "- [ ] Step" or "- [x] Step"
    const checkMatch = line.match(/^(?:[-*]|\d+\.)\s*\[([ xX>!])\]\s*(.+)$/)
    if (checkMatch) {
      const flag = checkMatch[1].toLowerCase()
      const body = checkMatch[2].replace(/\*\*/g, '').trim()
      items.push({
        id: `item-${counter++}`,
        title: body,
        completed: flag === 'x',
      })
      continue
    }

    // Match numbered points "1. Step" or "1) Step"
    const numMatch = line.match(/^(\d+)[\.\)]\s+(.+)$/)
    if (numMatch) {
      const body = numMatch[2].replace(/\*\*/g, '').trim()
      items.push({
        id: `item-${counter++}`,
        title: body,
        completed: false,
      })
      continue
    }

    // Match markdown headers with emojis e.g. "### ✏️ Modifiche"
    const headerMatch = line.match(/^#{1,4}\s+(.+)$/)
    if (headerMatch) {
      const body = headerMatch[1].replace(/\*\*/g, '').trim()
      if (body.length > 3) {
        items.push({
          id: `item-${counter++}`,
          title: body,
          completed: false,
          tag: 'FASE',
        })
      }
    }
  }

  // Fallback if no structured points found
  if (items.length === 0 && plan.planText.trim().length > 0) {
    items.push({
      id: 'item-1',
      title: 'Analisi requisiti e contesto di progetto',
      completed: false,
    })
    items.push({
      id: 'item-2',
      title: 'Implementazione delle modifiche richieste',
      completed: false,
    })
    items.push({
      id: 'item-3',
      title: 'Verifica e test finale di correttezza',
      completed: false,
    })
  }

  return items
}
