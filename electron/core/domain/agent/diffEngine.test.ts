import { describe, it, expect } from 'vitest'
import {
  parseUnifiedDiff,
  computeLineDiff,
  countDiffLines,
  summarizeDiff,
  collapseContext,
  groupDiffIntoHunks,
  reconstructWithApprovedHunks,
} from './diffEngine'

describe('diffEngine — unified diff parsing', () => {
  it('should parse a multi-file git diff into per-file hunks with add/delete counts', () => {
    const raw = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,4 +1,5 @@ export function app()',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4',
      ' const d = 5',
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -10,2 +10,1 @@',
      '-old line one',
      '-old line two',
      '+merged line',
    ].join('\n')

    const files = parseUnifiedDiff(raw)

    expect(files.length).toBe(2)
    expect(files[0].displayPath).toBe('src/app.ts')
    expect(files[0].additions).toBe(2)
    expect(files[0].deletions).toBe(1)
    expect(files[0].hunks.length).toBe(1)
    expect(files[0].hunks[0].header).toContain('@@ -1,4 +1,5 @@')

    expect(files[1].displayPath).toBe('README.md')
    expect(files[1].additions).toBe(1)
    expect(files[1].deletions).toBe(2)

    expect(summarizeDiff(files)).toEqual({ files: 2, additions: 3, deletions: 3 })
  })

  it('should assign correct old/new line numbers within a hunk', () => {
    const raw = [
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -5,3 +5,3 @@',
      ' keep',
      '-removed',
      '+added',
      ' tail',
    ].join('\n')

    const [file] = parseUnifiedDiff(raw)
    const lines = file.hunks[0].lines

    expect(lines[0]).toMatchObject({ type: 'context', oldLineNumber: 5, newLineNumber: 5 })
    expect(lines[1]).toMatchObject({ type: 'del', oldLineNumber: 6, newLineNumber: null })
    expect(lines[2]).toMatchObject({ type: 'add', oldLineNumber: null, newLineNumber: 6 })
    expect(lines[3]).toMatchObject({ type: 'context', oldLineNumber: 7, newLineNumber: 7 })
  })

  it('should flag added, deleted, renamed and binary files', () => {
    const added = parseUnifiedDiff(
      ['diff --git a/new.ts b/new.ts', 'new file mode 100644', '--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1,1 @@', '+hello'].join('\n')
    )
    expect(added[0].status).toBe('added')
    expect(added[0].displayPath).toBe('new.ts')
    expect(added[0].additions).toBe(1)

    const deleted = parseUnifiedDiff(
      ['diff --git a/gone.ts b/gone.ts', 'deleted file mode 100644', '--- a/gone.ts', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-bye'].join('\n')
    )
    expect(deleted[0].status).toBe('deleted')
    expect(deleted[0].displayPath).toBe('gone.ts')
    expect(deleted[0].deletions).toBe(1)

    const renamed = parseUnifiedDiff(
      ['diff --git a/old.ts b/new.ts', 'similarity index 98%', 'rename from old.ts', 'rename to new.ts'].join('\n')
    )
    expect(renamed[0].status).toBe('renamed')
    expect(renamed[0].oldPath).toBe('old.ts')
    expect(renamed[0].newPath).toBe('new.ts')

    const binary = parseUnifiedDiff(
      ['diff --git a/logo.png b/logo.png', 'Binary files a/logo.png and b/logo.png differ'].join('\n')
    )
    expect(binary[0].isBinary).toBe(true)
  })

  it('should return an empty list for empty or non-diff input instead of throwing', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff(null as any)).toEqual([])
    expect(parseUnifiedDiff('No uncommitted changes in Git working tree.')).toEqual([])
  })
})

describe('diffEngine — before/after line diff', () => {
  it('should mark only the changed lines when editing inside a file', () => {
    const before = 'line1\nline2\nline3\nline4'
    const after = 'line1\nline2 changed\nline3\nline4'

    const lines = computeLineDiff(before, after)

    expect(countDiffLines(lines)).toEqual({ additions: 1, deletions: 1 })
    expect(lines.filter((l) => l.type === 'del')[0].content).toBe('line2')
    expect(lines.filter((l) => l.type === 'add')[0].content).toBe('line2 changed')
    expect(lines.filter((l) => l.type === 'context').length).toBe(3)
  })

  it('should report a brand-new file as all additions and a cleared file as all deletions', () => {
    expect(countDiffLines(computeLineDiff('', 'a\nb\nc'))).toEqual({ additions: 3, deletions: 0 })
    expect(countDiffLines(computeLineDiff('a\nb\nc', ''))).toEqual({ additions: 0, deletions: 3 })
  })

  it('should produce no changes for identical content', () => {
    const lines = computeLineDiff('same\ncontent', 'same\ncontent')
    expect(countDiffLines(lines)).toEqual({ additions: 0, deletions: 0 })
    expect(lines.every((l) => l.type === 'context')).toBe(true)
  })

  it('should keep line numbering consistent across insertions', () => {
    const lines = computeLineDiff('a\nc', 'a\nb\nc')
    const added = lines.find((l) => l.type === 'add')!

    expect(added.content).toBe('b')
    expect(added.newLineNumber).toBe(2)
    expect(added.oldLineNumber).toBeNull()
    expect(lines[lines.length - 1]).toMatchObject({ type: 'context', oldLineNumber: 2, newLineNumber: 3 })
  })

  it('should stay responsive on a large file with a single changed line', () => {
    const big = Array.from({ length: 8000 }, (_, i) => `line ${i}`).join('\n')
    const edited = big.replace('line 4000', 'line 4000 edited')

    const startedAt = Date.now()
    const lines = computeLineDiff(big, edited)
    const elapsed = Date.now() - startedAt

    expect(countDiffLines(lines)).toEqual({ additions: 1, deletions: 1 })
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('diffEngine — context collapsing', () => {
  it('should elide long unchanged runs while keeping a window around each change', () => {
    const before = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l20', 'l20 changed')

    const collapsed = collapseContext(computeLineDiff(before, after), 2)
    const gaps = collapsed.filter((entry) => entry.kind === 'gap')
    const kept = collapsed.filter((entry) => entry.kind === 'line')

    expect(gaps.length).toBe(2)
    // 2 changed lines + up to 2 context lines either side of each.
    expect(kept.length).toBeLessThanOrEqual(8)
    expect(kept.some((entry) => entry.kind === 'line' && entry.line.content === 'l20 changed')).toBe(true)
  })

  it('should keep every line when the file is small enough to have no elidable run', () => {
    const collapsed = collapseContext(computeLineDiff('a\nb', 'a\nB'), 3)
    expect(collapsed.every((entry) => entry.kind === 'line')).toBe(true)
  })
})

describe('diffEngine — per-hunk grouping and reconstruction', () => {
  it('should group a diff with two separate changes into two independent hunks', () => {
    const before = 'line1\nline2\nline3\nline4\nline5'
    const after = 'line1\nCHANGED2\nline3\nline4\nCHANGED5'
    const lines = computeLineDiff(before, after)
    const hunks = groupDiffIntoHunks(lines)

    expect(hunks).toHaveLength(2)
    expect(hunks[0].lines.some((l) => l.type === 'del' && l.content === 'line2')).toBe(true)
    expect(hunks[0].lines.some((l) => l.type === 'add' && l.content === 'CHANGED2')).toBe(true)
    expect(hunks[1].lines.some((l) => l.type === 'add' && l.content === 'CHANGED5')).toBe(true)
  })

  it('should treat one contiguous run of changed lines as a single hunk', () => {
    const before = 'a\nb\nc\nd'
    const after = 'a\nX\nY\nd'
    const hunks = groupDiffIntoHunks(computeLineDiff(before, after))
    expect(hunks).toHaveLength(1)
  })

  it('reconstructWithApprovedHunks should apply only approved hunks and keep rejected hunks at their original content', () => {
    const before = 'line1\nline2\nline3\nline4\nline5'
    const after = 'line1\nCHANGED2\nline3\nline4\nCHANGED5'
    const lines = computeLineDiff(before, after)
    const hunks = groupDiffIntoHunks(lines)
    expect(hunks).toHaveLength(2)

    // Approve only the first hunk (line2 -> CHANGED2), reject the second (line5 -> CHANGED5).
    const result = reconstructWithApprovedHunks(lines, hunks, new Set([hunks[0].id]))
    expect(result).toBe('line1\nCHANGED2\nline3\nline4\nline5')
  })

  it('reconstructWithApprovedHunks should reproduce the full "after" text when every hunk is approved', () => {
    const before = 'a\nb\nc'
    const after = 'a\nB\nC'
    const lines = computeLineDiff(before, after)
    const hunks = groupDiffIntoHunks(lines)
    const result = reconstructWithApprovedHunks(lines, hunks, new Set(hunks.map((h) => h.id)))
    expect(result).toBe(after)
  })

  it('reconstructWithApprovedHunks should reproduce the original "before" text when no hunk is approved', () => {
    const before = 'a\nb\nc'
    const after = 'a\nB\nC'
    const lines = computeLineDiff(before, after)
    const hunks = groupDiffIntoHunks(lines)
    const result = reconstructWithApprovedHunks(lines, hunks, new Set())
    expect(result).toBe(before)
  })

  it('should isolate a single removed line as its own hunk when it sits between unchanged lines, leaving the rest untouched on rejection', () => {
    // Models a replace_chunk that drops one line: the surrounding lines survive as context.
    const before = 'keep1\nDROP\nkeep2'
    const after = 'keep1\nkeep2'
    const lines = computeLineDiff(before, after)
    const hunks = groupDiffIntoHunks(lines)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines).toEqual([{ type: 'del', content: 'DROP', oldLineNumber: 2, newLineNumber: null }])

    expect(reconstructWithApprovedHunks(lines, hunks, new Set([hunks[0].id]))).toBe(after)
    expect(reconstructWithApprovedHunks(lines, hunks, new Set())).toBe(before)
  })

  it('a full delete_file diff (proposed content is always empty) has no context lines, so it forms exactly one all-or-nothing hunk', () => {
    const before = 'keep1\nDROP\nkeep2'
    const lines = computeLineDiff(before, '')
    const hunks = groupDiffIntoHunks(lines)
    expect(hunks).toHaveLength(1)

    expect(reconstructWithApprovedHunks(lines, hunks, new Set([hunks[0].id]))).toBe('')
    expect(reconstructWithApprovedHunks(lines, hunks, new Set())).toBe(before)
  })
})
