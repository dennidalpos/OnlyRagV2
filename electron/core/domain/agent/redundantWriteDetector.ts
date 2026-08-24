/**
 * Redundant Write Detector.
 *
 * A `write_file` whose content is already on disk changes nothing, yet the executor answered
 * it with "Successfully wrote file X" — a sentence indistinguishable from the one a real
 * change produces. Two things followed from that, and together they are the churn described
 * in the blueprint §5.4.
 *
 * The model never learns the write was a no-op, so nothing discourages the next one: 21-31
 * `write_file` calls for ~14 files in a 50-step session.
 *
 * Worse, the orchestrator classifies mutation by TOOL NAME (see `isMutating` in
 * agentOrchestratorToolResultProcessor.ts), so a write that changed no byte still cleared
 * `flags.hasVerifiedBuild`. A green build was therefore invalidated by a rewrite that could
 * not possibly have broken it, and the model had to run the build again to reach `finish` —
 * which is symptom A, the four consecutive green `npm run build` runs in the ERESOLVE probe.
 * The two symptoms are one mechanism: build green -> identical rewrite -> evidence discarded
 * -> build again.
 *
 * Pure domain: the caller supplies what is on disk.
 */

/** Why a proposed write is being treated as a no-op, for the message handed to the model. */
export type RedundantWriteKind = 'identical' | 'line_endings_only'

export interface RedundantWriteVerdict {
  /** True when applying this write would leave the file semantically unchanged. */
  isRedundant: boolean
  kind?: RedundantWriteKind
  /** The file on disk is empty, so "already up to date" would be a false reassurance. */
  isEmpty?: boolean
}

/**
 * Normalises the two differences that are not code changes.
 *
 * Line endings: a model emits `\n` on a Windows workspace whose files were written `\r\n` by
 * a scaffolder (or the reverse). Every rewrite then differs on every line while the source is
 * character-for-character the same program. This is the dominant source of phantom rewrites
 * on the platform this app targets.
 *
 * Trailing newline at EOF: present or absent, it is the same file to every compiler, and a
 * model reproducing its own earlier output routinely drops or adds it.
 *
 * Nothing else is normalised. Leading whitespace, interior blank lines and indentation are all
 * real edits — collapsing them would let this function declare a genuine reformat redundant
 * and silently discard it.
 */
function normalizeForComparison(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\n+$/, '')
}

/**
 * Decides whether writing `proposedContent` over `existingContent` would change anything.
 *
 * `fileExists` is required and not inferred from an empty `existingContent`: creating an empty
 * file is a real mutation (it is how a module gets its placeholder), while rewriting an
 * already-empty file with nothing is not, and the two are indistinguishable from the content
 * alone.
 */
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

/**
 * The tool result a redundant write returns.
 *
 * It states the fact first — the file already holds this content — because the model's next
 * decision depends on knowing the deliverable exists, not on being scolded. The directives
 * name the moves that DO advance the session, in the order the plan needs them: verify, mark,
 * or move to the next file. "Do not write this file again" alone is the kind of pure
 * prohibition that produced the loop in the first place.
 */
export function buildRedundantWriteNotice(filePath: string, kind: RedundantWriteKind, isEmpty = false): string {
  // The contradiction this branch exists to end, measured on 2026-08-25: the model wrote
  // `src/services/TaskService.ts` with an empty body, the file was created at zero bytes, and
  // every identical retry was answered "the deliverable exists and is correct" — while the
  // milestone probe, correctly, reported the same file as missing-or-empty and `update_plan`
  // refused the milestone. Two system messages about one file, saying opposite things, for
  // eighteen blocked steps. An empty file is not a deliverable and must never be called one.
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
