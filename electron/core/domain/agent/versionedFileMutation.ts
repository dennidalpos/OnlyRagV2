import { computeLineDiff } from '../../../../shared/domain/agent/diffEngine'

export interface ExactReplacement {
  targetContent: string
  replacementContent: string
}

export type ExactReplacementResult = { success: true; content: string; replacedCount: number } | { success: false; error: string }

function occurrences(content: string, target: string): number {
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(target, offset)) >= 0) {
    count++
    offset += target.length
  }
  return count
}

/** 1-based line numbers where `needle` starts in `haystack`. */
function lineNumbersOf(haystack: string, needle: string, limit = 5): number[] {
  const lines: number[] = []
  let from = 0
  while (lines.length < limit) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    lines.push(haystack.slice(0, at).split('\n').length)
    from = at + Math.max(1, needle.length)
  }
  return lines
}

/**
 * What the model needs to fix a failed exact match: where an ambiguous target occurs, or where the
 * first line of a missing target appears once whitespace is ignored (the usual cause is indentation,
 * tabs versus spaces, or line-number prefixes copied from a ranged read).
 */
function describeMatchFailure(content: string, target: string, count: number): string {
  if (!target) return 'targetContent is empty: copy the exact text to replace from the file.'
  if (count > 1) {
    return `It occurs at lines ${lineNumbersOf(content, target).join(', ')}: include more surrounding lines so the target is unique.`
  }
  const firstLine = target.split('\n').find((line) => line.trim()) ?? ''
  if (/^\s*\d+:\s/.test(firstLine))
    return 'targetContent starts with a line-number prefix ("12: "): copy the text without the prefixes read_file adds to ranged reads.'
  const wanted = firstLine.trim()
  const fileLines = content.split('\n')
  const near = wanted ? fileLines.findIndex((line) => line.trim() === wanted) : -1
  if (near >= 0) {
    return `Its first line appears at line ${near + 1} with different indentation or whitespace, or the following lines differ: read the file around line ${near + 1} and copy the text exactly.`
  }
  return 'Its first line does not occur in the file: read the file again and copy the current text exactly, or use write_file if you are creating the file.'
}

/** Applies an edit only when each expected chunk identifies one current location. */
export function applyUniqueReplacements(content: string, replacements: readonly ExactReplacement[]): ExactReplacementResult {
  const hadCrlf = content.includes('\r\n')
  let next = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let index = 0; index < replacements.length; index++) {
    const target = replacements[index].targetContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const replacement = replacements[index].replacementContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const count = target ? occurrences(next, target) : 0
    if (count !== 1) {
      return { success: false, error: `Chunk #${index + 1} matched ${count} locations; exactly one is required. ${describeMatchFailure(next, target, count)}` }
    }
    next = next.replace(target, () => replacement)
  }

  if (hadCrlf) next = next.replace(/\n/g, '\r\n')
  return { success: true, content: next, replacedCount: replacements.length }
}

export function compactMutationDiff(current: string, proposed: string, limit = 16): string {
  const changed = computeLineDiff(current, proposed)
    .filter((line) => line.type !== 'context')
    .slice(0, limit)
  if (changed.length === 0) return '(no line changes)'
  return changed.map((line) => `${line.type === 'add' ? '+' : '-'} ${line.content.slice(0, 180)}`).join('\n')
}

export function versionConflictFeedback(filePath: string, expected: string | undefined, actual: string, diff?: string): string {
  const detail = diff ? `\nCurrent vs proposed diff:\n${diff}` : ''
  if (actual === 'missing') {
    return `[FILE VERSION CONFLICT: ${filePath}]\nExpected: ${expected || 'a version from read_file'}\nCurrent: missing\nThe file is absent. Do not read it; if creation is still intended, call write_file again to create it.${detail}\nNo content was written.`
  }
  return `[FILE VERSION CONFLICT: ${filePath}]\nExpected: ${expected || 'a version from read_file'}\nCurrent: ${actual}${detail}\nRead the file again and generate a fresh, uniquely-targeted edit. No content was written.`
}
