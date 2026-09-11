/** Prevents coding, ingestion and translation tasks from overlapping. */
export type GlobalTaskModule = 'coding' | 'ingestion' | 'translation'

let busyModule: GlobalTaskModule | null = null

/** Returns the current lock holder without side effects — safe to call from a guard check. */
export function peekGlobalTaskLock(): GlobalTaskModule | null {
  return busyModule
}

/** Acquires the lock when free or already owned by `module`. */
export function acquireGlobalTaskLock(module: GlobalTaskModule): boolean {
  if (busyModule !== null && busyModule !== module) return false
  busyModule = module
  return true
}

/** Releases only when `module` is the current holder. */
export function releaseGlobalTaskLock(module: GlobalTaskModule): void {
  if (busyModule !== module) return
  busyModule = null
}
