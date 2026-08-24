/**
 * Plan Falsifiability Normalizer.
 *
 * Planners routinely emit entries that are not steps at all. "Design the two-column layout
 * for tablet", "Ensure buttons have a minimum touch target of 44x44 px", "Fix every overflow
 * issue" name no artefact and carry no command: nothing can ever show they happened, and
 * nothing can ever show they did not. They are acceptance criteria for work described
 * elsewhere in the plan, and listing them as separate steps has two costs — the agent burns
 * turns "doing" them, and the plan can never legitimately reach 100%.
 *
 * When such an entry stayed on the checklist the pressure to close it had to come from
 * somewhere, and it came from the wrong place: the orchestrator used to close any milestone
 * naming no artefact on the next successful write. Session-1787476734227-nkn0 therefore
 * reported "Run the application to ensure it is fully runnable" as verified, at 13/15
 * overall, on a project with no entrypoint. The fix is upstream — do not let a criterion
 * masquerade as a step in the first place.
 *
 * Criteria are folded into the milestone whose work they qualify, so no requirement is lost:
 * the agent still reads every one of them, attached to the deliverable it constrains.
 */

import { extractDeliverablePaths } from './milestoneDeliverableResolver'
import { isCompletionMilestoneTitle, type PlanMilestone } from './planAndSolveGraph'

/**
 * A backticked token is the plan format's way of pointing at something concrete — a path
 * (`src/App.tsx`) or a command (`npm run build`). Either one gives the milestone a target
 * that can be checked, which is what separates a step from a criterion.
 */
const BACKTICKED_TOKEN = /`[^`\n]+`/

/**
 * A milestone is falsifiable when something could show it done or not done: a file it names,
 * a command it names, or an explicit verificationCommand. The closing milestone is exempt —
 * the finish tool owns it, and it must stay a step of its own.
 *
 * The bar is deliberately low. Folding a real step away loses work; keeping a vague one
 * merely leaves the plan slightly noisier, and nothing downstream will close it without
 * evidence any more. So doubt resolves in favour of keeping the milestone.
 */
export function isFalsifiableMilestone(milestone: PlanMilestone): boolean {
  if (isCompletionMilestoneTitle(milestone.title)) return true
  if (milestone.verificationCommand) return true
  if (extractDeliverablePaths(milestone.title).length > 0) return true
  return BACKTICKED_TOKEN.test(milestone.title)
}

function appendCriteria(milestone: PlanMilestone, criteria: string[]): PlanMilestone {
  if (criteria.length === 0) return milestone
  return {
    ...milestone,
    title: [milestone.title.trim(), ...criteria.map((c) => c.trim())].filter(Boolean).join('; '),
  }
}

function consolidateDuplicateDeliverables(milestones: PlanMilestone[]): PlanMilestone[] {
  if (milestones.length <= 1) return milestones

  let didConsolidate = false
  const consolidated: PlanMilestone[] = []
  for (const m of milestones) {
    const prev = consolidated[consolidated.length - 1]
    if (!prev || isCompletionMilestoneTitle(prev.title) || isCompletionMilestoneTitle(m.title)) {
      consolidated.push(m)
      continue
    }

    const prevDeliverables = extractDeliverablePaths(prev.title)
    const currDeliverables = extractDeliverablePaths(m.title)

    // If both milestones have non-empty deliverables and they target the exact same file set
    if (
      prevDeliverables.length > 0 &&
      currDeliverables.length > 0 &&
      prevDeliverables.length === currDeliverables.length &&
      prevDeliverables.every((p) => currDeliverables.includes(p))
    ) {
      consolidated[consolidated.length - 1] = appendCriteria(prev, [m.title])
      didConsolidate = true
    } else {
      consolidated.push(m)
    }
  }

  if (!didConsolidate) return milestones

  return consolidated.map((m, idx) => ({ ...m, id: `m-${idx + 1}` }))
}

/**
 * Returns a plan in which every entry is falsifiable, with non-falsifiable ones folded in as
 * acceptance criteria, adjacent duplicates consolidated, and the ids renumbered m-1..m-N.
 *
 * A criterion attaches to the preceding falsifiable milestone — the work it qualifies
 * normally comes first — and forward to the next one when it appears before any. A plan with
 * nothing falsifiable in it is returned untouched: there is nothing to attach to, and
 * silently emptying the checklist would be worse than leaving it imperfect.
 */
export function normalizePlanFalsifiability(milestones: PlanMilestone[]): PlanMilestone[] {
  if (!Array.isArray(milestones) || milestones.length === 0) return []
  if (milestones.every(isFalsifiableMilestone)) return consolidateDuplicateDeliverables(milestones)
  if (!milestones.some(isFalsifiableMilestone)) return milestones

  const normalized: PlanMilestone[] = []
  let leadingCriteria: string[] = []

  for (const milestone of milestones) {
    if (isFalsifiableMilestone(milestone)) {
      normalized.push(appendCriteria(milestone, leadingCriteria))
      leadingCriteria = []
      continue
    }

    const previous = normalized[normalized.length - 1]
    // The closing milestone must not absorb implementation criteria: it would stop reading
    // as "write the final report and stop", which is how the finish tool identifies it.
    if (previous && !isCompletionMilestoneTitle(previous.title)) {
      normalized[normalized.length - 1] = appendCriteria(previous, [milestone.title])
    } else {
      leadingCriteria.push(milestone.title)
    }
  }

  // Criteria trailing after the closing milestone attach to the last real work instead.
  if (leadingCriteria.length > 0) {
    const lastWorkIndex = normalized.findIndex((m) => isCompletionMilestoneTitle(m.title))
    const target = lastWorkIndex > 0 ? lastWorkIndex - 1 : normalized.length - 1
    normalized[target] = appendCriteria(normalized[target], leadingCriteria)
  }

  const falsifiableCleaned = normalized.map((m, idx) => ({ ...m, id: `m-${idx + 1}` }))
  return consolidateDuplicateDeliverables(falsifiableCleaned)
}
