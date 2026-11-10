import { useEffect, useState } from 'react'
import type { OllamaModelMetrics } from '../types'

/** Installed/show facts and transient runtime allocation, keyed by model tag. */
export function useOllamaModelMetrics(host?: string, isActive = true) {
  const [metrics, setMetrics] = useState<Record<string, OllamaModelMetrics>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!isActive) return
    let cancelled = false

    const load = async () => {
      if (!window.electronAPI?.getOllamaModelMetrics) {
        setLoaded(true)
        return
      }
      try {
        const result = await window.electronAPI.getOllamaModelMetrics({ host })
        if (!cancelled) setMetrics(result || {})
      } catch {
        if (!cancelled) setMetrics({})
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [host, isActive])

  return { metrics, loaded }
}
