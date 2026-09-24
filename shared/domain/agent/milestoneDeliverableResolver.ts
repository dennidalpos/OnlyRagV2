/** Result of probing one candidate deliverable on disk. */
export interface DeliverableProbeResult {
  exists: boolean
  contentLength: number
  /** File body for small files to detect placeholders. */
  content?: string
  contentHash?: string
}

/** Injected probe; domain never touches fs. */
export type DeliverableProbe = (relativePath: string) => DeliverableProbeResult

export type MilestoneDeliverableStatus = 'satisfied' | 'unsatisfied' | 'not_applicable'

export interface MilestoneDeliverableDeclaration {
  title: string
  filePaths?: string[]
}

/** Marker for deliverables on disk awaiting verification command pass. */
export const AWAITING_VERIFICATION_MARKER = 'Awaiting a passing verification command'

/** Path-shaped token pattern. */
const PATH_TOKEN_PATTERN = /[A-Za-z0-9_@.\-]+(?:[\\/][A-Za-z0-9_@.\-]+)*\.[A-Za-z][A-Za-z0-9]{0,7}/g

/** Wrapping punctuation around path tokens. */
const WRAPPING_CHARS = /^[`'"“”‘’(\[{<]+|[`'"“”‘’)\]}>,.;:!?]+$/g

/** Extracts normalized workspace-relative file deliverable paths from a milestone title. */
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

/** Placeholder marker pattern. */
const PLACEHOLDER_MARKER_PATTERN = /\b(todo|fixme|placeholder|stub|not implemented|implement (me|here|this)|coming soon|lorem ipsum)\b/i

const MIN_MEANINGFUL_LENGTH = 12
const MAX_MARKER_ONLY_LENGTH = 200
const MAX_MARKER_ONLY_CODE_LINES = 2

/** True when a file's body is a placeholder rather than a deliverable. */
export function isPlaceholderContent(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed.length < MIN_MEANINGFUL_LENGTH) return true

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const codeLines = lines.filter((line) => !COMMENT_LINE_PATTERN.test(line))

  // Comment-only body is treated as placeholder
  if (codeLines.length === 0) return true

  return codeLines.length <= MAX_MARKER_ONLY_CODE_LINES && trimmed.length <= MAX_MARKER_ONLY_LENGTH && PLACEHOLDER_MARKER_PATTERN.test(trimmed)
}

/** Decides whether a milestone's file deliverables are all present on disk. */
export function resolveMilestoneDeliverableStatus(milestone: string | MilestoneDeliverableDeclaration, probe: DeliverableProbe): MilestoneDeliverableStatus {
  const deliverables = resolveDeclaredFilePaths(milestone)
  if (deliverables.length === 0) return 'not_applicable'

  return findUnsatisfiedDeliverables(milestone, probe).length === 0 ? 'satisfied' : 'unsatisfied'
}

/** The milestone's declared deliverables that are absent, empty, or still placeholders. */
export function findUnsatisfiedDeliverables(milestone: string | MilestoneDeliverableDeclaration, probe: DeliverableProbe): string[] {
  return resolveDeclaredFilePaths(milestone).filter((deliverable) => {
    const result = probe(deliverable)
    if (!result.exists || result.contentLength <= 0) return true
    return result.content !== undefined && isPlaceholderContent(result.content)
  })
}

/** True when `mutatedPath` is one of the files this milestone set out to produce. */
export function isDeliverableOfMilestone(milestone: string | MilestoneDeliverableDeclaration, mutatedPath: string | undefined): boolean {
  if (!mutatedPath) return false

  const normalisedMutation = mutatedPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalisedMutation) return false

  return resolveDeclaredFilePaths(milestone).some((deliverable) => normalisedMutation === deliverable || normalisedMutation.endsWith(`/${deliverable}`))
}

/** Script-module extensions resolved from extensionless imports. */
const SCRIPT_MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/i

/**
 * Finds declared deliverables matching writtenPath under a different script extension
 * (e.g. App.js vs App.jsx) within the same directory and stem.
 */
export function findModuleExtensionAliases(declaredPaths: readonly string[], writtenPath: string): string[] {
  const written = writtenPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!SCRIPT_MODULE_EXTENSION.test(written)) return []
  const writtenStem = written.replace(SCRIPT_MODULE_EXTENSION, '').toLowerCase()
  return declaredPaths.filter((declared) => {
    const normalized = declared.replace(/\\/g, '/').replace(/^\.\//, '')
    return (
      SCRIPT_MODULE_EXTENSION.test(normalized) &&
      normalized.toLowerCase() !== written.toLowerCase() &&
      normalized.replace(SCRIPT_MODULE_EXTENSION, '').toLowerCase() === writtenStem
    )
  })
}
