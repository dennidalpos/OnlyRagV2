import { extractDeliverablePaths } from './milestoneDeliverableResolver'
import { isCompletionMilestoneTitle, type PlanMilestone } from './planAndSolveGraph'

/** A backticked token is the plan format's way of pointing at something concrete — a path (`src/App.tsx`) or a command (`npm run build`). */
/** A backticked token that something could actually run: a command has whitespace between its program and its arguments (`npm run build`, `pytest -q`), and a path has an extension, which `extractDeliverablePaths` already recognises on its own. */
const BACKTICKED_TOKEN = /`([^`\n]+)`/g
const DIRECTORY_MUTATION_TOKEN =
  /^(?:(?:mkdir|md|move|mv|copy|cp|rename|ren|rmdir|rd|remove|rm)\b|git\s+(?:mv|rm)\b|(?:\.{1,2}[\\/]|[a-z0-9_.-]+[\\/])[^`\n]*\s+(?:to|into|->|→)\s+(?:\.{1,2}[\\/]|[a-z0-9_.-]+[\\/]))/i

function hasRunnableBacktickedCommand(title: string): boolean {
  for (const match of title.matchAll(BACKTICKED_TOKEN)) {
    const token = match[1].trim()
    if (/\S\s+\S/.test(token) && !DIRECTORY_MUTATION_TOKEN.test(token)) return true
  }
  return false
}

/** A milestone is falsifiable when something could show it done or not done: a file it names, a command it names, or an explicit verificationCommand. */
export function isFalsifiableMilestone(milestone: PlanMilestone): boolean {
  if (isCompletionMilestoneTitle(milestone)) return true
  if (milestone.verificationCommand) return true
  if (milestone.filePaths?.length) return true
  if (extractDeliverablePaths(milestone.title).length > 0) return true
  return hasRunnableBacktickedCommand(milestone.title)
}

/** Keeps a criterion as a step of its own, for the two positions where the only thing left to fold it into is the closing milestone. */
function asOwnMilestone(title: string): PlanMilestone {
  return { id: '', title, status: 'pending' }
}

function appendCriteria(milestone: PlanMilestone, criteria: string[]): PlanMilestone {
  if (criteria.length === 0) return milestone
  if (milestone.filePaths || milestone.acceptanceCriteria) {
    return {
      ...milestone,
      acceptanceCriteria: [...(milestone.acceptanceCriteria || []), ...criteria.map((criterion) => criterion.trim())],
    }
  }
  return {
    ...milestone,
    title: [milestone.title.trim(), ...criteria.map((c) => c.trim())].filter(Boolean).join('; '),
  }
}

/** Returns a plan in which every entry is falsifiable, with non-falsifiable ones folded in as acceptance criteria and the ids renumbered m-1..m-N. */
export function normalizePlanFalsifiability(milestones: PlanMilestone[]): PlanMilestone[] {
  if (!Array.isArray(milestones) || milestones.length === 0) return []
  if (milestones.every(isFalsifiableMilestone)) return milestones
  if (!milestones.some(isFalsifiableMilestone)) return milestones

  const normalized: PlanMilestone[] = []
  let leadingCriteria: string[] = []

  for (const milestone of milestones) {
    if (isFalsifiableMilestone(milestone)) {
      // Criteria waiting for a home must not land on the closing milestone: it would stop reading as "write the final report and stop", which is how the finish tool identifies it.
      if (leadingCriteria.length > 0 && isCompletionMilestoneTitle(milestone)) {
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
    if (previous && !isCompletionMilestoneTitle(previous)) {
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
    const closingIndex = normalized.findIndex((m) => isCompletionMilestoneTitle(m))
    const target = closingIndex > 0 ? closingIndex - 1 : closingIndex === -1 ? normalized.length - 1 : -1
    if (target >= 0) {
      normalized[target] = appendCriteria(normalized[target], leadingCriteria)
    } else {
      normalized.unshift(...leadingCriteria.map(asOwnMilestone))
    }
  }

  return normalized.map((m, idx) => ({ ...m, id: `m-${idx + 1}` }))
}
