import { useState, useEffect, useCallback, useRef } from 'react'
import { DiagnosticsData, AppSettings } from '../types'
import { electronApi } from '../services/electronApi'
import { logger } from '../lib/logger'
import { DOCUMENTS_CHANGED_EVENT, notifyDocumentsChanged } from './useIngestedDocuments'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

export const DIAGNOSTICS_STARTUP_RETRY_MS = 1000

export function getDiagnosticsPollDelay(sidecarStatus: DiagnosticsData['sidecar']['status'] | undefined, intervalMs: number): number {
  return sidecarStatus === 'online' ? intervalMs : Math.min(intervalMs, DIAGNOSTICS_STARTUP_RETRY_MS)
}

export function useDiagnostics(
  settings: AppSettings,
  onSelectDefaultModelIfUnset: (model: string) => void,
  settingsReady: boolean,
  intervalMs: number = 10000,
) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null)
  const [isScanning, setIsScanning] = useState<boolean>(false)
  const prevSidecarStatusRef = useRef<string | null>(null)
  const prevDocsCountRef = useRef<number | null>(null)
  // Set while this hook dispatches documents-changed itself, so its own listener does not rescan for it.
  const notifyingRef = useRef(false)

  const runDiagnosticsScan = useCallback(async () => {
    setIsScanning(true)
    try {
      const data = await electronApi().runDiagnostics({ host: settings.ollamaHost })
      if (data) {
        setDiagnostics(data)

        // Notify document list observers when sidecar comes online or document count changes
        const currentStatus = data.sidecar?.status || 'offline'
        const currentCount = data.sidecar?.documentsCount ?? 0

        if (
          (prevSidecarStatusRef.current !== 'online' && currentStatus === 'online') ||
          (prevDocsCountRef.current !== null && prevDocsCountRef.current !== currentCount)
        ) {
          notifyingRef.current = true
          try {
            notifyDocumentsChanged()
          } finally {
            notifyingRef.current = false
          }
        }

        prevSidecarStatusRef.current = currentStatus
        prevDocsCountRef.current = currentCount

        if (data.ollama.models.length > 0) {
          onSelectDefaultModelIfUnset(data.ollama.models[0])
        }
      }
      return data
    } catch (err: unknown) {
      logger.error('useDiagnostics', `Scan failed: ${errorMessage(err)}`)
      return null
    } finally {
      setIsScanning(false)
    }
  }, [settings.ollamaHost, onSelectDefaultModelIfUnset])

  useEffect(() => {
    if (!settingsReady) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const scanAndSchedule = async () => {
      const data = await runDiagnosticsScan()
      if (cancelled) return
      timer = setTimeout(scanAndSchedule, getDiagnosticsPollDelay(data?.sidecar?.status, intervalMs))
    }

    void scanAndSchedule()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [runDiagnosticsScan, settingsReady, intervalMs])

  // An ingestion or deletion changes the sidebar document count now, not at the next poll.
  useEffect(() => {
    if (!settingsReady) return
    const onDocumentsChanged = () => {
      if (!notifyingRef.current) void runDiagnosticsScan()
    }
    window.addEventListener(DOCUMENTS_CHANGED_EVENT, onDocumentsChanged)
    return () => window.removeEventListener(DOCUMENTS_CHANGED_EVENT, onDocumentsChanged)
  }, [runDiagnosticsScan, settingsReady])

  return { diagnostics, isScanning, refreshDiagnostics: runDiagnosticsScan }
}
