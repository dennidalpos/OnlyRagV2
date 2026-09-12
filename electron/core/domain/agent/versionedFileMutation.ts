import { computeLineDiff } from '../../../../shared/domain/agent/diffEngine'

export interface ExactReplacement {
  targetContent: string
  replacementContent: string
}

export type ExactReplacementResult =
  | { success: true; content: string; replacedCount: number }
  | { success: false; error: string }

function occurrences(content: string, target: string): number {
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(target, offset)) >= 0) {
    count++
    offset += target.length
  }
  return count
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
      return { success: false, error: `Chunk #${index + 1} matched ${count} locations; exactly one is required.` }
    }
    next = next.replace(target, replacement)
  }

  if (hadCrlf) next = next.replace(/\n/g, '\r\n')
  return { success: true, content: next, replacedCount: replacements.length }
}

export function compactMutationDiff(current: string, proposed: string, limit = 16): string {
  const changed = computeLineDiff(current, proposed).filter((line) => line.type !== 'context').slice(0, limit)
  if (changed.length === 0) return '(no line changes)'
  return changed.map((line) => `${line.type === 'add' ? '+' : '-'} ${line.content.slice(0, 180)}`).join('\n')
}

export function versionConflictFeedback(filePath: string, expected: string | undefined, actual: string, diff?: string): string {
  const detail = diff ? `\nCurrent vs proposed diff:\n${diff}` : ''
  if (actual === 'missing') {
    return `[FILE VERSION CONFLICT: ${filePath}]\nExpected: ${expected || 'a version from read_file'}\nCurrent: missing\nThe file is absent. Do not require a read of it; if creation is still intended, call write_file without expectedContentHash.${detail}\nNo content was written.`
  }
  return `[FILE VERSION CONFLICT: ${filePath}]\nExpected: ${expected || 'a version from read_file'}\nCurrent: ${actual}${detail}\nRead the file again and generate a fresh, uniquely-targeted edit. No content was written.`
}
