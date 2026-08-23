/**
 * Reference-counted freeze of background scrolling.
 *
 * Scrollbars are painted by the browser outside every stacking context, so a `fixed inset-0`
 * overlay never covers one: with a modal open the underlying scrollbar stayed visible AND the
 * content behind stayed scrollable. No modal in the app locked scroll, which is why the
 * project-removal dialog in Coding showed the panel's scrollbar straight through it.
 *
 * The counting is what makes this non-trivial and worth its own module: modals stack (the
 * skill hub opens the skill editor, which opens the custom-hub guide), and the first one to
 * close must not restore scrolling while another is still open.
 */

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

/** Number of locks currently held. Exposed for tests and diagnostics. */
export function getBodyScrollLockCount(): number {
  return activeLockCount
}
