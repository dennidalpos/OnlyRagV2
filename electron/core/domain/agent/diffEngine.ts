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
      hunk.lines.push({ type: 'add', content: line.slice(1).replace(/\r$/, ''), oldLineNumber: null, newLineNumber: newLineNo++ })
      current.additions++
    } else if (line.startsWith('-')) {
      hunk.lines.push({ type: 'del', content: line.slice(1).replace(/\r$/, ''), oldLineNumber: oldLineNo++, newLineNumber: null })
      current.deletions++
    } else if (line.startsWith(' ') || line === '') {
      hunk.lines.push({ type: 'context', content: line.slice(1).replace(/\r$/, ''), oldLineNumber: oldLineNo++, newLineNumber: newLineNo++ })
    }
  }

  pushFile()
  return files
}

import { diffLines } from 'diff'

/**
 * Myers line diff between two file revisions using the standard `diff` engine.
 * Generates exact per-line add/del/context blocks with 1-based line numbering.
 */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  if (!before && !after) return []

  const beforeNorm = before || ''
  const afterNorm = after || ''

  if (beforeNorm === afterNorm) {
    const lines = beforeNorm.split(/\r?\n/)
    return lines.map((content, idx) => ({
      type: 'context',
      content,
      oldLineNumber: idx + 1,
      newLineNumber: idx + 1,
    }))
  }

  const changes = diffLines(beforeNorm, afterNorm)
  const result: DiffLine[] = []
  let oldNo = 1
  let newNo = 1

  for (const change of changes) {
    const rawVal = change.value
    const lines = rawVal.split(/\r?\n/)
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }

    if (change.added) {
      for (const line of lines) {
        result.push({
          type: 'add',
          content: line,
          oldLineNumber: null,
          newLineNumber: newNo++,
        })
      }
    } else if (change.removed) {
      for (const line of lines) {
        result.push({
          type: 'del',
          content: line,
          oldLineNumber: oldNo++,
          newLineNumber: null,
        })
      }
    } else {
      for (const line of lines) {
        result.push({
          type: 'context',
          content: line,
          oldLineNumber: oldNo++,
          newLineNumber: newNo++,
        })
      }
    }
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

/** One independently approvable cluster of consecutive add/del lines from a flat computeLineDiff() result. */
export interface DiffHunkGroup {
  /** Position among this diff's hunks, in document order — the id used by reconstructWithApprovedHunks. */
  id: number
  lines: DiffLine[]
}

/**
 * Splits a flat computeLineDiff() result into independently approvable hunks: each maximal
 * run of consecutive add/del lines (context lines are never part of a hunk — they are
 * identical on both sides, so there is nothing to approve or reject about them).
 */
export function groupDiffIntoHunks(lines: ReadonlyArray<DiffLine>): DiffHunkGroup[] {
  const hunks: DiffHunkGroup[] = []
  let current: DiffLine[] = []

  for (const line of lines) {
    if (line.type === 'context') {
      if (current.length > 0) {
        hunks.push({ id: hunks.length, lines: current })
        current = []
      }
      continue
    }
    current.push(line)
  }
  if (current.length > 0) hunks.push({ id: hunks.length, lines: current })

  return hunks
}

/**
 * Reconstructs the file content that results from applying only the approved hunks: context
 * lines are kept as-is, an approved hunk contributes its "after" side (its add lines), and a
 * rejected hunk contributes its "before" side (its del lines, i.e. no change). `hunks` MUST be
 * groupDiffIntoHunks(lines) for the same `lines` array — reconstruction walks both in lockstep.
 */
export function reconstructWithApprovedHunks(
  lines: ReadonlyArray<DiffLine>,
  hunks: ReadonlyArray<DiffHunkGroup>,
  approvedHunkIds: ReadonlySet<number>
): string {
  const out: string[] = []
  let hunkIndex = 0
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'context') {
      out.push(line.content)
      i++
      continue
    }

    const hunk = hunks[hunkIndex]
    hunkIndex++
    const approved = hunk ? approvedHunkIds.has(hunk.id) : false
    const hunkLineCount = hunk ? hunk.lines.length : 0
    for (const hunkLine of hunk ? hunk.lines : []) {
      if (approved && hunkLine.type === 'add') out.push(hunkLine.content)
      if (!approved && hunkLine.type === 'del') out.push(hunkLine.content)
    }
    i += hunkLineCount || 1 // defensive: never stall if hunks/lines somehow desync
  }

  return out.join('\n')
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
