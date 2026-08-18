import { useCallback, useState } from 'react'
import { GuestOsInfo } from '../types'
import { logger } from '../lib/logger'

/** Host facts and dev toolchain inventory reported by `workspace:inspect-guest-os`. */
export function useGuestOsDiagnostics() {
  const [guestOsInfo, setGuestOsInfo] = useState<GuestOsInfo | null>(null)
  const [isInspectingOs, setIsInspectingOs] = useState<boolean>(false)

  const loadGuestOsInfo = useCallback(async () => {
    if (!window.electronAPI?.inspectGuestOsEnvironment) return
    setIsInspectingOs(true)
    try {
      setGuestOsInfo(await window.electronAPI.inspectGuestOsEnvironment())
    } catch (err: any) {
      logger.warn('useGuestOsDiagnostics', `Failed inspecting guest OS: ${err?.message}`)
    } finally {
      setIsInspectingOs(false)
    }
  }, [])

  return { guestOsInfo, isInspectingOs, loadGuestOsInfo }
}
