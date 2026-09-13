import { useEffect } from 'react'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '../lib/bodyScrollLock'

/** Freezes background scrolling for as long as an overlay is open. */
export function useLockBodyScroll(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return
    acquireBodyScrollLock()
    return releaseBodyScrollLock
  }, [isLocked])
}
