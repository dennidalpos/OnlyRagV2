let activeLockCount = 0
let restoreOverflow: string | null = null

/** Freezes scrolling, remembering the page's own overflow on the first lock. */
export function acquireBodyScrollLock(): void {
  if (activeLockCount === 0) {
    restoreOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  activeLockCount++
}

/** Releases one lock, restoring the original overflow only once the last one is gone. */
export function releaseBodyScrollLock(): void {
  if (activeLockCount === 0) return
  activeLockCount--
  if (activeLockCount === 0) {
    document.body.style.overflow = restoreOverflow ?? ''
    restoreOverflow = null
  }
}

/** @internal Number of locks currently held; exposed for tests. */
export function getBodyScrollLockCount(): number {
  return activeLockCount
}
