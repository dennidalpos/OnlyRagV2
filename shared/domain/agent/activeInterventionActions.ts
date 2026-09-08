import type { PlanMilestone } from './planAndSolveGraph'

const MAX_ACTIVE_ACTIONS = 4

/** Expands only the current intervention into a bounded execution sequence. */
export function buildActiveInterventionActions(intervention: PlanMilestone): string[] {
  const files = intervention.filePaths || []
  const actions: string[] = []
  if (files.length > 0) {
    actions.push(`Read ${files.join(', ')} and only the linked callers or consumers required by this change.`)
    actions.push(`Apply one scoped edit at a time to ${files.join(', ')}.`)
  }
  actions.push('Keep linked files coherent only where the edited contract requires it.')
  actions.push(intervention.verificationCommand
    ? `After the coherent edit group, run \`${intervention.verificationCommand}\`; intermediate edit states are not final failures.`
    : 'After the coherent edit group, check the acceptance criteria; intermediate edit states are not final failures.')
  return actions.slice(0, MAX_ACTIVE_ACTIONS)
}
