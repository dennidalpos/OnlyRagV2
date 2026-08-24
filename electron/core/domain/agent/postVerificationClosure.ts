/**
 * Post-Verification Closure.
 *
 * Answers one question the system could previously not ask: *the build is green — is this
 * session allowed to end?*
 *
 * Everything needed for the answer already existed and was never combined. `hasVerifiedBuild`
 * says a real verification passed and nothing has been written since (it is cleared by every
 * mutation — see invalidateVerifiedBuild). `selectMilestonesProvenByVerification` has already
 * promoted every milestone that green build could speak for. So the milestones still open
 * after a pass are exactly two kinds, and they call for opposite responses:
 *
 *  - `unsatisfied` — the milestone names files that are missing or hold placeholder content.
 *    Real work is left. The session must NOT close, whatever the build says about the rest.
 *  - `not_applicable` — the milestone names no artefact at all ("ensure buttons have a 44x44
 *    touch target", "run the application"). No build can ever prove or disprove it, so it can
 *    never reach `verified` through verification, and it is precisely what deadlocks the plan.
 *
 * That deadlock is the churn's standing cause. The plan block's active-milestone directive 4
 * reads "Do NOT invoke finish until all operational checklist milestones are completed and
 * verified" — an instruction that, with an unprovable milestone open, forbids finishing
 * forever. The model has a green build, a milestone it believes is done, no legal way to close
 * it, and one action left that always succeeds: run the build again. It is the same shape the
 * loop guard's own header warns about — a prohibition with no exit — and no amount of
 * additional discouragement can resolve it, because the model's problem is not that it wants
 * to repeat the build, it is that nothing else is permitted.
 *
 * This module supplies the exit: name the unprovable milestones and tell the model to close
 * them with `update_plan` on its own judgement, then finish. Judgement is the only instrument
 * that applies — `milestoneUpdateAuthority` already lets a milestone naming no artefact be
 * closed by its own command, and the Definition of Done gate still runs the project's real
 * verification before `finish` is honoured, so nothing here weakens what is actually checked.
 *
 * Pure domain: the caller supplies each milestone's deliverable status.
 */

import { isCompletionMilestoneTitle } from './planAndSolveGraph'
import type { PlanMilestone } from './planAndSolveGraph'
import type { MilestoneDeliverableStatus } from './milestoneDeliverableResolver'

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

/**
 * Milestones that still hold the plan open.
 *
 * `failed` entries are excluded for the same reason every other consumer excludes them: the
 * loop guard abandoned them deliberately, the plan block already orders them reported as
 * incomplete, and counting them here would make closure unreachable for exactly the sessions
 * that most need to close. The completion milestone is excluded because the finish tool owns it.
 */
function selectOpenMilestones(milestones: readonly PlanMilestone[]) {
  return milestones.filter(
    (m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m.title)
  )
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

/**
 * The directive that replaces the blanket "do not finish" prohibition once closure is legal.
 *
 * Written as a single imperative sequence with no alternatives to weigh. A directive that
 * offers a model a choice invites it to delegate that choice — the ERESOLVE work established
 * that the hard way, when a two-option "pick one and run it now" made the model call `ask` in
 * AGENT mode, where nobody can answer.
 *
 * Returns null when the session is not closable, so the caller's ordinary path is untouched.
 */
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
