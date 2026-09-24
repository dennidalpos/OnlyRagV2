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

export function recordFileVersion(evidence: FileVersionEvidence, filePath: string, contentHash: string): void {
  const key = fileVersionEvidenceKey(filePath)
  if (!key || !contentHash) return
  // Re-inserting moves the entry to the end, so eviction drops the least recently seen file.
  delete evidence[key]
  evidence[key] = contentHash
  const keys = Object.keys(evidence)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_FILE_VERSION_EVIDENCE))) {
    delete evidence[stale]
  }
}

export function forgetFileVersion(evidence: FileVersionEvidence, filePath: string): void {
  delete evidence[fileVersionEvidenceKey(filePath)]
}

export function knownFileVersion(evidence: FileVersionEvidence | undefined, filePath: string): string | undefined {
  return evidence?.[fileVersionEvidenceKey(filePath)]
}

/** Restores evidence saved before it became per-file (a single `{ filePath, contentHash }`). */
export function restoreFileVersionEvidence(
  saved: FileVersionEvidence | undefined,
  legacy: { filePath: string; contentHash: string } | undefined,
): FileVersionEvidence {
  const evidence: FileVersionEvidence = {}
  for (const [filePath, contentHash] of Object.entries(saved ?? {})) {
    if (typeof contentHash === 'string') recordFileVersion(evidence, filePath, contentHash)
  }
  if (legacy?.filePath && legacy.contentHash && !knownFileVersion(evidence, legacy.filePath)) {
    recordFileVersion(evidence, legacy.filePath, legacy.contentHash)
  }
  return evidence
}
