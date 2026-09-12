import { useCallback, useEffect, useState } from 'react'
import type { OllamaGenerationStatus } from '../../shared/types'

export type OllamaOperationState = 'queued' | 'running' | null

export function resolveOllamaOperationState(status: OllamaGenerationStatus, operationId: string): OllamaOperationState {
  if (status.active?.id === operationId) return 'running'
  if (status.queued.some((job) => job.id === operationId)) return 'queued'
  return null
}

export function useOllamaGenerationState() {
  const [operationId, setOperationId] = useState<string | null>(null)
  const [generationState, setGenerationState] = useState<OllamaOperationState>(null)

  const trackOperation = useCallback((id: string | null) => {
    setOperationId(id)
    setGenerationState(id ? 'queued' : null)
  }, [])

  useEffect(() => {
    const electronAPI = window.electronAPI
    if (!operationId || !electronAPI?.getOllamaGenerationStatus) return

    let active = true
    const refresh = async () => {
      try {
        const status = await electronAPI.getOllamaGenerationStatus()
        if (active) {
          const next = resolveOllamaOperationState(status, operationId)
          if (next) setGenerationState(next)
        }
      } catch {
        if (active) setGenerationState(null)
      }
    }

    void refresh()
    const timer = window.setInterval(refresh, 250)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [operationId])

  return { generationState, trackOperation }
}
