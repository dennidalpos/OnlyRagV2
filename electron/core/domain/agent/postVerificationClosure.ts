import { isCompletionMilestoneTitle } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { MilestoneDeliverableStatus } from '../../../../shared/domain/agent/milestoneDeliverableResolver'

export type ClosureState =
  /** Work genuinely remains, or nothing has been verified yet. */
  | 'not_closable'
  /** Every open milestone names no artefact: the model must close them itself, then finish. */
  | 'close_unprovable_then_finish'
  /** The plan is fully accounted for and the build is green: finish is the only move left. */
  | 'finish_now'

export interface ClosureAssessment {
  state: ClosureState
  /** Open milestones no verification can ever prove; empty unless `state` says otherwise. */
  unprovable: Array<{ id: string; title: string }>
}

export interface ClosureInput {
  /** A real verification passed and no file has been written since. */
  hasVerifiedBuild: boolean
  milestones: readonly PlanMilestone[]
  deliverableStatusOf: (milestone: PlanMilestone) => MilestoneDeliverableStatus
}

/** Milestones that still hold the plan open. */
function selectOpenMilestones(milestones: readonly PlanMilestone[]) {
  return milestones.filter((m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m))
}

export function assessPostVerificationClosure(input: ClosureInput): ClosureAssessment {
  if (!input.hasVerifiedBuild) return { state: 'not_closable', unprovable: [] }

  const open = selectOpenMilestones(input.milestones)
  if (open.length === 0) return { state: 'finish_now', unprovable: [] }

  const unprovable: Array<{ id: string; title: string }> = []
  for (const milestone of open) {
    // One milestone whose files are missing is enough: the project is incomplete regardless of
    // what compiled. Reported as not closable without looking at the rest.
    if (input.deliverableStatusOf(milestone) !== 'not_applicable') {
      return { state: 'not_closable', unprovable: [] }
    }
    unprovable.push({ id: milestone.id, title: milestone.title })
  }

  return { state: 'close_unprovable_then_finish', unprovable }
}

/** The directive that replaces the blanket "do not finish" prohibition once closure is legal. */
export function buildClosureDirective(assessment: ClosureAssessment): string | null {
  if (assessment.state === 'not_closable') return null

  const common = [
    '[PROJECT VERIFIED — CLOSE THE SESSION]',
    'The project verification command has PASSED and no file has been modified since it ran, so the code on disk right now is the code that was verified.',
    'Re-running a build, a test or any command changes nothing and cannot make this more true.',
  ]

  if (assessment.state === 'finish_now') {
    return [
      ...common,
      'Every milestone is accounted for.',
      'Your next tool call MUST be "finish", with a full final report (in the user\'s language) covering: functional changes, files created or modified, verification results, and anything left incomplete.',
    ].join('\n')
  }

  const list = assessment.unprovable.map((m) => `- ${m.id}: ${m.title}`).join('\n')
  return [
    ...common,
    `The only milestones still open name no file, so NO command can ever prove them and they will stay open forever unless you close them:`,
    list,
    'Directives:',
    `1. Call "update_plan" now and mark ${assessment.unprovable.length === 1 ? 'that milestone' : 'those milestones'} verified, on your own assessment of the code you wrote. This is the intended way to close a milestone that names no artefact.`,
    '2. Then invoke "finish" with a full final report (in the user\'s language) covering: functional changes, files created or modified, verification results, and anything left incomplete.',
    '3. Do NOT write any more files and do NOT re-run the verification command.',
  ].join('\n')
}
