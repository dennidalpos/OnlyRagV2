import { useEffect } from 'react'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '../lib/bodyScrollLock'

/**
 * Freezes background scrolling for as long as an overlay is open.
 *
 * The reference counting that makes stacked modals behave lives in `lib/bodyScrollLock.ts`,
 * where it can be tested without a React renderer.
 */
export function useLockBodyScroll(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return
    acquireBodyScrollLock()
    return releaseBodyScrollLock
  }, [isLocked])
}
