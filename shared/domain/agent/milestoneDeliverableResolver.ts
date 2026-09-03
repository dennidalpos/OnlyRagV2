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
  /**
   * The file body, supplied only when the file is small enough to plausibly be a placeholder.
   * Left undefined for anything large, which is definitionally not a stub.
   */
  content?: string
}

/** Injected by the infrastructure/application layer; the domain never touches `fs`. */
export type DeliverableProbe = (relativePath: string) => DeliverableProbeResult

export type MilestoneDeliverableStatus = 'satisfied' | 'unsatisfied' | 'not_applicable'

/**
 * The sentence that marks a milestone whose files are all on disk but which no verification
 * has proven yet.
 *
 * Declared here because three modules read it — the note builder, the active-milestone
 * selector, and the re-delivery check — and it lived as a copied string literal in each. This
 * module is the one they can all import without closing a cycle.
 */
export const AWAITING_VERIFICATION_MARKER = 'Awaiting a passing verification command'

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

/** Line prefixes that mark a comment across the languages a generated project can use. */
const COMMENT_LINE_PATTERN = /^(\/\/|\/\*|\*\/|\*|#|--|<!--|;)/

/** Words a model writes when it is deferring the actual work. */
const PLACEHOLDER_MARKER_PATTERN = /\b(todo|fixme|placeholder|stub|not implemented|implement (me|here|this)|coming soon|lorem ipsum)\b/i

/** Below this, a file carries no implementation whatever its extension. */
const MIN_MEANINGFUL_LENGTH = 12

/** A marker only condemns a file that has essentially nothing else in it. */
const MAX_MARKER_ONLY_LENGTH = 200
const MAX_MARKER_ONLY_CODE_LINES = 2

/**
 * True when a file's body is a placeholder rather than a deliverable.
 *
 * Deliberately conservative and purely syntactic, for the same reason as the rest of this
 * module: it must behave identically for every model and stack. A false positive only ever
 * leaves a milestone `unsatisfied` -- the safe direction, since the resolver can then never
 * close it on evidence that is not there.
 */
export function isPlaceholderContent(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed.length < MIN_MEANINGFUL_LENGTH) return true

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const codeLines = lines.filter((line) => !COMMENT_LINE_PATTERN.test(line))

  // Nothing but comments: the model described the work instead of doing it.
  if (codeLines.length === 0) return true

  return (
    codeLines.length <= MAX_MARKER_ONLY_CODE_LINES &&
    trimmed.length <= MAX_MARKER_ONLY_LENGTH &&
    PLACEHOLDER_MARKER_PATTERN.test(trimmed)
  )
}

/**
 * Decides whether a milestone's file deliverables are all present on disk.
 *
 * Returns `not_applicable` when the title names no path at all — such milestones
 * ("design the tablet layout") have no falsifiable artefact. Callers must NOT read that
 * as permission to close them: it means the opposite, that nothing here can attest to
 * them either way.
 *
 * A title that names paths which do not exist yet returns `unsatisfied`, which is
 * also what a false-positive path token ("Node.js") yields: the resolver can only
 * ever fail to advance a milestone, never advance one whose files are missing.
 *
 * A path that exists but holds placeholder content is `unsatisfied` too -- see
 * `isPlaceholderContent`. Existence with a non-zero size used to be the entire bar.
 */
export function resolveMilestoneDeliverableStatus(
  title: string,
  probe: DeliverableProbe
): MilestoneDeliverableStatus {
  const deliverables = extractDeliverablePaths(title)
  if (deliverables.length === 0) return 'not_applicable'

  return findUnsatisfiedDeliverables(title, probe).length === 0 ? 'satisfied' : 'unsatisfied'
}

/**
 * The milestone's declared deliverables that are absent, empty, or still placeholders.
 *
 * Same evidence `resolveMilestoneDeliverableStatus` reduces to a single verdict, kept itemised
 * so a refusal can name the files instead of asserting that something is missing. A milestone
 * titled "Create `vite.config.ts`; Create `tsconfig.json`" that reports only `tsconfig.json`
 * tells the model exactly what to write next; "deliverables missing" tells it to guess.
 */
export function findUnsatisfiedDeliverables(title: string, probe: DeliverableProbe): string[] {
  return extractDeliverablePaths(title).filter((deliverable) => {
    const result = probe(deliverable)
    if (!result.exists || result.contentLength <= 0) return true
    // Presence and a non-zero size were the whole bar, so a file holding "// TODO: implement"
    // closed its milestone. Content the probe deemed small enough to inspect is now checked.
    return result.content !== undefined && isPlaceholderContent(result.content)
  })
}

/**
 * True when `mutatedPath` is one of the files this milestone set out to produce.
 *
 * Presence alone is not evidence that THIS milestone advanced: a run that writes
 * `src/App.tsx` would otherwise close any milestone whose files happened to already
 * exist. Requiring the write to land on the milestone's own deliverable ties the
 * closure to work actually done for it.
 *
 * Comparison is on normalised workspace-relative paths, and also accepts an absolute
 * path that ends with the deliverable, since tool results report absolute paths.
 */
export function isDeliverableOfMilestone(title: string, mutatedPath: string | undefined): boolean {
  if (!mutatedPath) return false

  const normalisedMutation = mutatedPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalisedMutation) return false

  return extractDeliverablePaths(title).some(
    (deliverable) =>
      normalisedMutation === deliverable ||
      normalisedMutation.endsWith(`/${deliverable}`)
  )
}
