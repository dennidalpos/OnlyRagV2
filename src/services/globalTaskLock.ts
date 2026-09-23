/** Prevents coding, ingestion and translation tasks from overlapping. */
export type GlobalTaskModule = 'coding' | 'ingestion' | 'translation'

let busyModule: GlobalTaskModule | null = null
/** Holders within the owning module: document and in-place translation share the 'translation' key. */
let holders = 0

/** Returns the current lock holder without side effects — safe to call from a guard check. */
export function peekGlobalTaskLock(): GlobalTaskModule | null {
  return busyModule
}

/** Acquires the lock when free or already owned by `module`; each successful call needs one release. */
export function acquireGlobalTaskLock(module: GlobalTaskModule): boolean {
  if (busyModule !== null && busyModule !== module) return false
  busyModule = module
  holders += 1
  return true
}

/** Releases one hold of `module`; the lock frees only when its last holder releases. */
export function releaseGlobalTaskLock(module: GlobalTaskModule): void {
  if (busyModule !== module) return
  holders -= 1
  if (holders <= 0) {
    holders = 0
    busyModule = null
  }
}
