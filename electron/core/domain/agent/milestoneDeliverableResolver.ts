/**
 * Milestone Deliverable Resolver.
 *
 * A milestone whose only deliverable is "this file must exist" had no way to reach
 * `verified`: trackVerification only advances on run_tests / open_in_browser / a build
 * command, and the sole remaining path was the model volunteering an `update_plan` call.
 * Models that never emit `update_plan` therefore froze the plan on its first milestone,
 * and the prompt re-issued that same active milestone every turn until the stagnation
 * circuit breaker killed the session (see coding_agent_audit.log session-1787445915590-u395:
 * 36 steps, 0/21 milestones, 20 consecutive loop blocks).
 *
 * This module reads the deliverable out of the milestone title itself. It is deliberately
 * syntactic — it recognises the shape of a path, not any framework, language or filename —
 * so it behaves identically for every model and every project stack.
 *
 * Pure domain: disk access is injected by the caller as a `DeliverableProbe`.
 */

/** Result of probing one candidate deliverable on disk. */
export interface DeliverableProbeResult {
  exists: boolean
  contentLength: number
}

/** Injected by the infrastructure/application layer; the domain never touches `fs`. */
export type DeliverableProbe = (relativePath: string) => DeliverableProbeResult

export type MilestoneDeliverableStatus = 'satisfied' | 'unsatisfied' | 'not_applicable'

/**
 * A path-shaped token: an optional directory chain plus a `stem.extension` tail.
 * The extension must START with a letter so version numbers ("React 18.2", "v0.1.0")
 * are not mistaken for files, and the whole token must be free of whitespace.
 */
const PATH_TOKEN_PATTERN = /[A-Za-z0-9_@.\-]+(?:[\\/][A-Za-z0-9_@.\-]+)*\.[A-Za-z][A-Za-z0-9]{0,7}/g

/** Wrapping punctuation the planner routinely puts around a path (backticks, quotes, brackets). */
const WRAPPING_CHARS = /^[`'"“”‘’(\[{<]+|[`'"“”‘’)\]}>,.;:!?]+$/g

/**
 * Extracts the file deliverables referenced by a milestone title, normalised to
 * forward-slash workspace-relative form and de-duplicated in first-seen order.
 */
export function extractDeliverablePaths(title: string): string[] {
  if (!title || typeof title !== 'string') return []

  const found: string[] = []
  const seen = new Set<string>()

  for (const rawToken of title.split(/\s+/)) {
    const token = rawToken.replace(WRAPPING_CHARS, '')
    if (!token) continue

    const matches = token.match(PATH_TOKEN_PATTERN)
    if (!matches) continue

    for (const match of matches) {
      const normalised = match.replace(/\\/g, '/').replace(/^\.\//, '')
      // A bare extension ("*.tsx", ".env.local") carries no identifiable target.
      if (normalised.startsWith('.') || normalised.startsWith('/')) continue
      if (seen.has(normalised)) continue
      seen.add(normalised)
      found.push(normalised)
    }
  }

  return found
}

/**
 * Decides whether a milestone's file deliverables are all present on disk.
 *
 * Returns `not_applicable` when the title names no path at all — such milestones
 * ("design the tablet layout") have no falsifiable artefact and are left to the
 * existing verification paths and to the loop guard's structural escape.
 *
 * A title that names paths which do not exist yet returns `unsatisfied`, which is
 * also what a false-positive path token ("Node.js") yields: the resolver can only
 * ever fail to advance a milestone, never advance one whose files are missing.
 */
export function resolveMilestoneDeliverableStatus(
  title: string,
  probe: DeliverableProbe
): MilestoneDeliverableStatus {
  const deliverables = extractDeliverablePaths(title)
  if (deliverables.length === 0) return 'not_applicable'

  for (const deliverable of deliverables) {
    const result = probe(deliverable)
    if (!result.exists || result.contentLength <= 0) return 'unsatisfied'
  }

  return 'satisfied'
}
