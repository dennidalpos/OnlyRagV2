import { useState, useEffect, useCallback, useRef } from 'react'
import { DiagnosticsData, AppSettings } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { notifyDocumentsChanged } from './useIngestedDocuments'

export function useDiagnostics(
  settings: AppSettings,
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void,
  intervalMs: number = 10000
) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null)
  const [isScanning, setIsScanning] = useState<boolean>(false)
  const prevSidecarStatusRef = useRef<string | null>(null)
  const prevDocsCountRef = useRef<number | null>(null)

  const runDiagnosticsScan = useCallback(async () => {
    setIsScanning(true)
    try {
      const data = await apiService.runDiagnostics()
      if (data) {
        setDiagnostics(data)
        
        // Notify document list observers when sidecar comes online or document count changes
        const currentStatus = data.sidecar?.status || 'offline'
        const currentCount = data.sidecar?.documentsCount ?? 0

        if (
          (prevSidecarStatusRef.current !== 'online' && currentStatus === 'online') ||
          (prevDocsCountRef.current !== null && prevDocsCountRef.current !== currentCount)
        ) {
          notifyDocumentsChanged()
        }

        prevSidecarStatusRef.current = currentStatus
        prevDocsCountRef.current = currentCount

        if (data.ollama.models.length > 0 && !settings.defaultModel) {
          onUpdateSettings({ defaultModel: data.ollama.models[0] })
        }
      }
    } catch (err: any) {
      logger.error('useDiagnostics', `Scan failed: ${err.message}`)
    } finally {
      setIsScanning(false)
    }
  }, [settings.defaultModel, onUpdateSettings])

  useEffect(() => {
    runDiagnosticsScan()
    const timer = setInterval(runDiagnosticsScan, intervalMs)
    return () => clearInterval(timer)
  }, [runDiagnosticsScan, intervalMs])

  return { diagnostics, isScanning, refreshDiagnostics: runDiagnosticsScan }
}
