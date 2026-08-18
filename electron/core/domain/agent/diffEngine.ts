/**
 * electron/core/domain/agent/diffEngine.ts
 *
 * Domain Layer — Diff parsing and computation.
 *
 * Two independent entry points, both pure and dependency-free:
 *
 *  1. `parseUnifiedDiff` turns the textual output of `git diff` into a structured,
 *     per-file / per-hunk model with add and delete counts, so the UI can render it
 *     line by line (red / green, hunk headers, per-file +/- badges) instead of dumping
 *     it into a monochrome <pre>.
 *  2. `computeLineDiff` produces the same line model from a raw before/after pair,
 *     for changes that never touch git — an agent's pending write_file or
 *     replace_file_content shown in the approval modal.
 *
 * Consumed by both processes (renderer panels and main-process metrics), mirroring
 * the existing cross-layer re-export convention in src/constants/promptPresets.ts.
 */

export type DiffLineType = 'add' | 'del' | 'context'

export interface DiffLine {
  type: DiffLineType
  /** Line text without the leading +/-/space marker. */
  content: string
  /** 1-based line number in the "before" side, or null for added lines. */
  oldLineNumber: number | null
  /** 1-based line number in the "after" side, or null for deleted lines. */
  newLineNumber: number | null
}

export interface DiffHunk {
  /** The raw @@ -a,b +c,d @@ header, section heading included when git emitted one. */
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'modified'

export interface DiffFileChange {
  oldPath: string
  newPath: string
  /** Path to show in the UI: the new path, or the old one for deletions. */
  displayPath: string
  status: DiffFileStatus
  isBinary: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

export interface DiffStats {
  files: number
  additions: number
  deletions: number
}

/** Files above this line count skip the O(n*m) LCS and fall back to a block replace. */
const MAX_LCS_LINES = 2500

function stripPathPrefix(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^"|"$/g, '')
  if (trimmed === '/dev/null') return ''
  return trimmed.replace(/^[ab]\//, '')
}

function emptyFile(): DiffFileChange {
  return {
    oldPath: '',
    newPath: '',
    displayPath: '',
    status: 'modified',
    isBinary: false,
    hunks: [],
    additions: 0,
    deletions: 0,
  }
}

/**
 * Parses unified diff text (`git diff`, `git diff --staged`, or any standard
 * `--- / +++ / @@` payload) into structured per-file changes.
 * Unknown or malformed sections are skipped rather than throwing: the input is
 * whatever a git binary happened to print, and a diff viewer must never crash on it.
 */
export function parseUnifiedDiff(rawDiff: string): DiffFileChange[] {
  if (!rawDiff || typeof rawDiff !== 'string') return []

  const lines = rawDiff.split(/\r?\n/)
  const files: DiffFileChange[] = []

  let current: DiffFileChange | null = null
  let hunk: DiffHunk | null = null
  let oldLineNo = 0
  let newLineNo = 0

  const pushHunk = () => {
    if (current && hunk) current.hunks.push(hunk)
    hunk = null
  }
  const pushFile = () => {
    pushHunk()
    if (current && (current.displayPath || current.hunks.length > 0)) files.push(current)
    current = null
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      pushFile()
      current = emptyFile()
      const match = line.match(/^diff --git (.+?) (.+)$/)
      if (match) {
        current.oldPath = stripPathPrefix(match[1])
        current.newPath = stripPathPrefix(match[2])
        current.displayPath = current.newPath || current.oldPath
      }
      continue
    }

    if (!current && (line.startsWith('--- ') || line.startsWith('+++ '))) {
      current = emptyFile()
    }
    if (!current) continue

    if (line.startsWith('new file mode')) {
      current.status = 'added'
      continue
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted'
      continue
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed'
      current.oldPath = stripPathPrefix(line.slice('rename from '.length))
      continue
    }
    if (line.startsWith('rename to ')) {
      current.status = 'renamed'
      current.newPath = stripPathPrefix(line.slice('rename to '.length))
      current.displayPath = current.newPath
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.isBinary = true
      continue
    }

    if (line.startsWith('--- ')) {
      pushHunk()
      const parsed = stripPathPrefix(line.slice(4))
      current.oldPath = parsed || current.oldPath
      if (!parsed) current.status = 'added'
      if (!current.displayPath) current.displayPath = current.newPath || current.oldPath
      continue
    }
    if (line.startsWith('+++ ')) {
      const parsed = stripPathPrefix(line.slice(4))
      current.newPath = parsed || current.newPath
      if (!parsed) current.status = 'deleted'
      current.displayPath = parsed || current.displayPath || current.oldPath
      continue
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
    if (hunkMatch) {
      pushHunk()
      oldLineNo = parseInt(hunkMatch[1], 10)
      newLineNo = parseInt(hunkMatch[3], 10)
      hunk = { header: line, oldStart: oldLineNo, newStart: newLineNo, lines: [] }
      continue
    }

    if (!hunk) continue

    // "\ No newline at end of file" is metadata, not content.
    if (line.startsWith('\\')) continue

    if (line.startsWith('+')) {
      hunk.lines.push({ type: 'add', content: line.slice(1), oldLineNumber: null, newLineNumber: newLineNo++ })
      current.additions++
    } else if (line.startsWith('-')) {
      hunk.lines.push({ type: 'del', content: line.slice(1), oldLineNumber: oldLineNo++, newLineNumber: null })
      current.deletions++
    } else if (line.startsWith(' ') || line === '') {
      hunk.lines.push({ type: 'context', content: line.slice(1), oldLineNumber: oldLineNo++, newLineNumber: newLineNo++ })
    }
  }

  pushFile()
  return files
}

/**
 * Longest-common-subsequence line diff between two file revisions.
 * Common prefix and suffix are trimmed first, which is what makes this cheap for the
 * usual case (a small edit inside a large file); the LCS table is only ever built over
 * the differing middle. Files whose differing region is still too large fall back to a
 * whole-block replace, which is accurate — just less granular.
 */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  // An empty side has zero lines, not one empty line: a newly created file must read as
  // pure additions, not "one blank line deleted, three added".
  const beforeLines = before ? before.split(/\r?\n/) : []
  const afterLines = after ? after.split(/\r?\n/) : []

  const result: DiffLine[] = []
  let oldNo = 1
  let newNo = 1

  // Common prefix
  let start = 0
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    result.push({ type: 'context', content: beforeLines[start], oldLineNumber: oldNo++, newLineNumber: newNo++ })
    start++
  }

  // Common suffix (never overlapping the prefix already consumed)
  let endBack = 0
  while (
    endBack < beforeLines.length - start &&
    endBack < afterLines.length - start &&
    beforeLines[beforeLines.length - 1 - endBack] === afterLines[afterLines.length - 1 - endBack]
  ) {
    endBack++
  }

  const midBefore = beforeLines.slice(start, beforeLines.length - endBack)
  const midAfter = afterLines.slice(start, afterLines.length - endBack)

  if (midBefore.length * midAfter.length > MAX_LCS_LINES * MAX_LCS_LINES || midBefore.length + midAfter.length > MAX_LCS_LINES * 2) {
    for (const content of midBefore) {
      result.push({ type: 'del', content, oldLineNumber: oldNo++, newLineNumber: null })
    }
    for (const content of midAfter) {
      result.push({ type: 'add', content, oldLineNumber: null, newLineNumber: newNo++ })
    }
  } else {
    const n = midBefore.length
    const m = midAfter.length
    // lcs[i][j] = length of the LCS of midBefore[i..] and midAfter[j..], flattened.
    const width = m + 1
    const lcs = new Int32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          midBefore[i] === midAfter[j]
            ? lcs[(i + 1) * width + (j + 1)] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)])
      }
    }

    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midBefore[i] === midAfter[j]) {
        result.push({ type: 'context', content: midBefore[i], oldLineNumber: oldNo++, newLineNumber: newNo++ })
        i++
        j++
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
        result.push({ type: 'del', content: midBefore[i], oldLineNumber: oldNo++, newLineNumber: null })
        i++
      } else {
        result.push({ type: 'add', content: midAfter[j], oldLineNumber: null, newLineNumber: newNo++ })
        j++
      }
    }
    while (i < n) {
      result.push({ type: 'del', content: midBefore[i++], oldLineNumber: oldNo++, newLineNumber: null })
    }
    while (j < m) {
      result.push({ type: 'add', content: midAfter[j++], oldLineNumber: null, newLineNumber: newNo++ })
    }
  }

  for (let k = beforeLines.length - endBack; k < beforeLines.length; k++) {
    result.push({ type: 'context', content: beforeLines[k], oldLineNumber: oldNo++, newLineNumber: newNo++ })
  }

  return result
}

/** Additions and deletions in a flat line list (from computeLineDiff or a single hunk). */
export function countDiffLines(lines: ReadonlyArray<DiffLine>): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (line.type === 'add') additions++
    else if (line.type === 'del') deletions++
  }
  return { additions, deletions }
}

/** Aggregate totals across parsed files, for the header badge and session metrics. */
export function summarizeDiff(files: ReadonlyArray<DiffFileChange>): DiffStats {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return { files: files.length, additions, deletions }
}

/**
 * Collapses long runs of unchanged lines so a small edit in a large file doesn't render
 * thousands of untouched rows. Returns the kept lines with `gap` markers describing how
 * many lines were elided, in render order.
 */
export function collapseContext(
  lines: ReadonlyArray<DiffLine>,
  contextRadius: number = 3
): Array<{ kind: 'line'; line: DiffLine } | { kind: 'gap'; hiddenCount: number }> {
  const keep = new Array<boolean>(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'context') continue
    for (let k = Math.max(0, i - contextRadius); k <= Math.min(lines.length - 1, i + contextRadius); k++) {
      keep[k] = true
    }
  }

  const out: Array<{ kind: 'line'; line: DiffLine } | { kind: 'gap'; hiddenCount: number }> = []
  let hidden = 0
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (hidden > 0) {
        out.push({ kind: 'gap', hiddenCount: hidden })
        hidden = 0
      }
      out.push({ kind: 'line', line: lines[i] })
    } else {
      hidden++
    }
  }
  if (hidden > 0) out.push({ kind: 'gap', hiddenCount: hidden })

  return out
}
