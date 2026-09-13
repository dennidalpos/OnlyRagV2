

/** Result of probing one candidate deliverable on disk. */
export interface DeliverableProbeResult {
  exists: boolean
  contentLength: number
  /**
   * The file body, supplied only when the file is small enough to plausibly be a placeholder.
   * Left undefined for anything large, which is definitionally not a stub.
   */
  content?: string
  contentHash?: string
}

/** Injected by the infrastructure/application layer; the domain never touches `fs`. */
export type DeliverableProbe = (relativePath: string) => DeliverableProbeResult

export type MilestoneDeliverableStatus = 'satisfied' | 'unsatisfied' | 'not_applicable'

export interface MilestoneDeliverableDeclaration {
  title: string
  filePaths?: string[]
}

/** Marker for milestones whose deliverables are on disk but awaiting verification command pass. */
export const AWAITING_VERIFICATION_MARKER = 'Awaiting a passing verification command'

/** A path-shaped token: an optional directory chain plus a `stem.extension` tail. */
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

export function resolveDeclaredFilePaths(input: string | MilestoneDeliverableDeclaration): string[] {
  if (typeof input === 'string') return extractDeliverablePaths(input)
  if (input.filePaths) {
    return [...new Set(input.filePaths.map((filePath) => filePath.replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean))]
  }
  return extractDeliverablePaths(input.title)
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

/** True when a file's body is a placeholder rather than a deliverable. */
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

/** Decides whether a milestone's file deliverables are all present on disk. */
export function resolveMilestoneDeliverableStatus(
  milestone: string | MilestoneDeliverableDeclaration,
  probe: DeliverableProbe
): MilestoneDeliverableStatus {
  const deliverables = resolveDeclaredFilePaths(milestone)
  if (deliverables.length === 0) return 'not_applicable'

  return findUnsatisfiedDeliverables(milestone, probe).length === 0 ? 'satisfied' : 'unsatisfied'
}

/** The milestone's declared deliverables that are absent, empty, or still placeholders. */
export function findUnsatisfiedDeliverables(milestone: string | MilestoneDeliverableDeclaration, probe: DeliverableProbe): string[] {
  return resolveDeclaredFilePaths(milestone).filter((deliverable) => {
    const result = probe(deliverable)
    if (!result.exists || result.contentLength <= 0) return true
    // Inspect small files to reject empty stubs or comment-only placeholders.
    return result.content !== undefined && isPlaceholderContent(result.content)
  })
}

/** True when `mutatedPath` is one of the files this milestone set out to produce. */
export function isDeliverableOfMilestone(milestone: string | MilestoneDeliverableDeclaration, mutatedPath: string | undefined): boolean {
  if (!mutatedPath) return false

  const normalisedMutation = mutatedPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalisedMutation) return false

  return resolveDeclaredFilePaths(milestone).some(
    (deliverable) =>
      normalisedMutation === deliverable ||
      normalisedMutation.endsWith(`/${deliverable}`)
  )
}
