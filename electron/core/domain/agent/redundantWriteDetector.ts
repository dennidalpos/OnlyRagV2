

/** Why a proposed write is being treated as a no-op, for the message handed to the model. */
export type RedundantWriteKind = 'identical' | 'line_endings_only'

export interface RedundantWriteVerdict {
  /** True when applying this write would leave the file semantically unchanged. */
  isRedundant: boolean
  kind?: RedundantWriteKind
  /** The file on disk is empty, so "already up to date" would be a false reassurance. */
  isEmpty?: boolean
}

/** Normalises the two differences that are not code changes. */
function normalizeForComparison(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\n+$/, '')
}

/** Decides whether writing `proposedContent` over `existingContent` would change anything. */
export function detectRedundantWrite(
  fileExists: boolean,
  existingContent: string,
  proposedContent: string
): RedundantWriteVerdict {
  if (!fileExists) return { isRedundant: false }
  // An empty file on disk is not a deliverable, and the notice must not say it is. See below.
  const isEmpty = !String(existingContent ?? '').trim()
  if (existingContent === proposedContent) return { isRedundant: true, kind: 'identical', isEmpty }
  if (normalizeForComparison(existingContent) === normalizeForComparison(proposedContent)) {
    return { isRedundant: true, kind: 'line_endings_only', isEmpty }
  }
  return { isRedundant: false }
}

/** The tool result a redundant write returns. */
export function buildRedundantWriteNotice(filePath: string, kind: RedundantWriteKind, isEmpty = false): string {
  // The contradiction this branch exists to end, measured on 2026-08-25: the model wrote `src/services/TaskService.ts` with an empty body, the file was created at zero bytes, and every identical retry was answered "the deliverable exists and is correct" — while th
  if (isEmpty) {
    return [
      `[NO-OP WRITE: "${filePath}" IS EMPTY AND STAYS EMPTY]`,
      `The file exists but holds nothing, and the content you just sent was empty too, so nothing changed.`,
      `An empty file cannot satisfy the milestone that names it: it will keep being reported as missing or placeholder however many times you write it.`,
      `Directives:`,
      `1. Call "write_file" on "${filePath}" again with the COMPLETE body of the file — the real implementation, not an empty string and not a TODO comment.`,
      `2. Do NOT send empty content for this file again.`,
    ].join('\n')
  }

  const detail =
    kind === 'line_endings_only'
      ? `The file "${filePath}" already holds exactly this content — the only difference was line endings, which is not a code change.`
      : `The file "${filePath}" already holds exactly this content, byte for byte.`

  return [
    `[NO-OP WRITE: "${filePath}" WAS ALREADY UP TO DATE]`,
    detail,
    'Nothing was written and nothing changed on disk. This is NOT an error: the deliverable exists and is correct.',
    'Because no file changed, any build or test you already ran is still valid — you do NOT need to re-run it.',
    'Directives:',
    `1. Do NOT write "${filePath}" again with this content.`,
    '2. If this file was the deliverable of your active milestone, that milestone\'s work is DONE: mark it with update_plan or run its verification command.',
    '3. Otherwise move to the next unfinished file or step.',
    '4. If every milestone is complete, invoke the "finish" tool with your final report.',
  ].join('\n')
}
