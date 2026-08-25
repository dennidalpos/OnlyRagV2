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
/**
 * A backticked token that something could actually run: a command has whitespace between its
 * program and its arguments (`npm run build`, `pytest -q`), and a path has an extension, which
 * `extractDeliverablePaths` already recognises on its own.
 *
 * A single backticked word with neither — `` `src/services/` ``, `` `tailwindcss` ``, `` `React` ``
 * — is a name, not a proof.
 */
const RUNNABLE_BACKTICKED_TOKEN = /`[^`\n]*\S\s+\S[^`\n]*`/

/**
 * A milestone is falsifiable when something could show it done or not done: a file it names, a
 * command it names, or an explicit verificationCommand. The closing milestone is exempt — the
 * finish tool owns it, and it must stay a step of its own.
 *
 * The bar is low, but it is no longer "any backtick at all", and the measurement that moved it
 * is worth keeping. The previous rule accepted every backticked token, so *"The project has a
 * clean architecture with a services folder — `src/services/`"* passed: a directory has no
 * extension, `extractDeliverablePaths` finds nothing in it, and the milestone survived as a step
 * that no file and no command could ever check. Four of the six plans generated on 2026-08-25
 * opened with exactly that shape, and in one run the model marked it `verified` **by its own
 * report at step 2** — a stamp inside the completion metric, which is the defect this whole
 * area exists to remove.
 *
 * That also retires the reasoning the old comment gave for the low bar — *"nothing downstream
 * will close it without evidence any more"*. False, and measured false: a milestone naming no
 * artefact resolves `not_applicable`, and `not_applicable` is closable by the model's own
 * judgement by design (§5.4). The bar has to do the work, because nothing after it will.
 *
 * Folding one of these loses nothing: the text becomes an acceptance criterion on the adjacent
 * real milestone, so the agent still reads the requirement, attached to a deliverable that can
 * be checked. Creating a directory was never a step anyway — writing a file inside it creates it.
 */
export function isFalsifiableMilestone(milestone: PlanMilestone): boolean {
  if (isCompletionMilestoneTitle(milestone.title)) return true
  if (milestone.verificationCommand) return true
  if (extractDeliverablePaths(milestone.title).length > 0) return true
  return RUNNABLE_BACKTICKED_TOKEN.test(milestone.title)
}

/**
 * Keeps a criterion as a step of its own, for the two positions where the only thing left to
 * fold it into is the closing milestone. The id is assigned by the renumbering pass at the end,
 * which is the single place ids are decided.
 */
function asOwnMilestone(title: string): PlanMilestone {
  return { id: '', title, status: 'pending' }
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
      // Criteria waiting for a home must not land on the closing milestone: it would stop
      // reading as "write the final report and stop", which is how the finish tool identifies
      // it. With nothing else to attach them to, they stay steps of their own — the same
      // choice this module already makes below, and the one its own rule prescribes: in doubt,
      // keep the entry, because a noisier plan costs less than work that disappears.
      if (leadingCriteria.length > 0 && isCompletionMilestoneTitle(milestone.title)) {
        normalized.push(...leadingCriteria.map(asOwnMilestone))
        leadingCriteria = []
      }
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
  //
  // When there is no real work to attach them to — a plan whose only falsifiable entry is the
  // closing milestone — they stay milestones of their own. Folding them in would rewrite "write
  // the final report and stop" into a step that also carries implementation criteria, which is
  // how the finish tool stops recognising it, and it is the same absorption the branch above
  // refuses. This module's rule applies here too: doubt resolves in favour of keeping the entry,
  // because a slightly noisier plan costs less than work that silently disappears.
  if (leadingCriteria.length > 0) {
    const closingIndex = normalized.findIndex((m) => isCompletionMilestoneTitle(m.title))
    const target = closingIndex > 0 ? closingIndex - 1 : closingIndex === -1 ? normalized.length - 1 : -1
    if (target >= 0) {
      normalized[target] = appendCriteria(normalized[target], leadingCriteria)
    } else {
      normalized.unshift(...leadingCriteria.map(asOwnMilestone))
    }
  }

  const falsifiableCleaned = normalized.map((m, idx) => ({ ...m, id: `m-${idx + 1}` }))
  return consolidateDuplicateDeliverables(falsifiableCleaned)
}
