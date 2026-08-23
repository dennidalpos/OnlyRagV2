/**
 * Cross-module task lock: the coding agent, ingestion, and translation modules each run
 * their own long-lived background task (agent turn, document ingest/in-place translation,
 * chunked translation) against shared resources — the resident Ollama model, workspace
 * files, LanceDB documents. Each module previously tracked its own busy flag in isolation
 * (useCodingAgent.isExecuting, useIngestion.isUploading/isTranslatingInplace,
 * useTranslation.isTranslating) with no coordination between them, so a user could start a
 * second task in another module while the first was still running.
 *
 * Plain module-level state (not React Context) because the three modules are lazy-loaded
 * sibling views with no common ancestor that already holds shared state — see
 * AppLayout.tsx's per-view React.lazy + Suspense split. Callers read the lock imperatively
 * inside their own start guards, so no subscription machinery is needed.
 */
export type GlobalTaskModule = 'coding' | 'ingestion' | 'translation'

let busyModule: GlobalTaskModule | null = null

/** Returns the current lock holder without side effects — safe to call from a guard check. */
export function peekGlobalTaskLock(): GlobalTaskModule | null {
  return busyModule
}

/**
 * Attempts to acquire the lock for `module`. Returns true if acquired (either the lock was
 * free, or `module` already held it — re-entrant for a single module's own re-renders).
 * Returns false if another module currently holds it.
 */
export function acquireGlobalTaskLock(module: GlobalTaskModule): boolean {
  if (busyModule !== null && busyModule !== module) return false
  busyModule = module
  return true
}

/** Releases the lock only if `module` is the current holder, so a stale release from a
 *  superseded task can never clobber a newer holder. */
export function releaseGlobalTaskLock(module: GlobalTaskModule): void {
  if (busyModule !== module) return
  busyModule = null
}
