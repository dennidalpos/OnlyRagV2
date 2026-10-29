/**
 * Per-file content versions the agent is entitled to edit against.
 *
 * An existing file may be overwritten only with the version the agent last saw. The agent sees a
 * version when read_file returns it, when the turn prompt carries the file's full on-disk content,
 * and when its own edit produced it. Recording only reads (a single slot consumed by the next edit)
 * turned every second write of the same file into a FILE VERSION CONFLICT and a mandatory re-read:
 * live full task run 11 of 2026-09-24 spent 12 of 50 steps on that churn and abandoned m-6 after
 * two such conflicts on src/App.jsx. A change the agent did not make still changes the hash, so an
 * external edit is still refused.
 */

export type FileVersionEvidence = Record<string, string>

/** Bounded so a long session cannot grow persisted state without limit. */
export const MAX_FILE_VERSION_EVIDENCE = 64

export function fileVersionEvidenceKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

/** Prefix of a version the agent saw only part of (a line range, or a read cut for the transcript). */
const PARTIAL_VIEW_PREFIX = 'partial:'

export function recordFileVersion(evidence: FileVersionEvidence, filePath: string, contentHash: string, options: { complete?: boolean } = {}): void {
  const key = fileVersionEvidenceKey(filePath)
  if (!key || !contentHash) return
  // A complete view already recorded for the same content is not downgraded by a later partial read.
  const stored = options.complete === false && evidence[key] !== contentHash ? `${PARTIAL_VIEW_PREFIX}${contentHash}` : contentHash
  // Re-inserting moves the entry to the end, so eviction drops the least recently seen file.
  delete evidence[key]
  evidence[key] = stored
  const keys = Object.keys(evidence)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_FILE_VERSION_EVIDENCE))) {
    delete evidence[stale]
  }
}

export function forgetFileVersion(evidence: FileVersionEvidence, filePath: string): void {
  delete evidence[fileVersionEvidenceKey(filePath)]
}

/**
 * The version the agent may edit against. A targeted replace is safe after a partial view (its exact,
 * unique target must still match), but a whole-file overwrite is not: the model would silently drop
 * every line it never saw. `wholeFile` therefore returns only versions seen in full.
 */
export function knownFileVersion(evidence: FileVersionEvidence | undefined, filePath: string, options: { wholeFile?: boolean } = {}): string | undefined {
  const stored = evidence?.[fileVersionEvidenceKey(filePath)]
  if (!stored) return undefined
  if (!stored.startsWith(PARTIAL_VIEW_PREFIX)) return stored
  return options.wholeFile ? undefined : stored.slice(PARTIAL_VIEW_PREFIX.length)
}

/** Restores the per-file evidence a saved run state carries, re-applying the bound and path normalization. */
export function restoreFileVersionEvidence(saved: FileVersionEvidence | undefined): FileVersionEvidence {
  const evidence: FileVersionEvidence = {}
  for (const [filePath, contentHash] of Object.entries(saved ?? {})) {
    if (typeof contentHash === 'string') recordFileVersion(evidence, filePath, contentHash)
  }
  return evidence
}
