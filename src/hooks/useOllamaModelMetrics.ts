import { useEffect, useState } from 'react'
import type { OllamaModelMetrics } from '../types'

/**
 * Per-model facts read from Ollama's `/api/tags`, keyed by model tag.
 *
 * Fetched once per host rather than per component: the endpoint lists every installed model in
 * one response, so a settings screen showing eight selectors makes one call, not eight.
 *
 * Failure is silent and returns an empty map. These values drive badges, and a settings screen
 * that cannot render because Ollama is down would be a worse outcome than a screen with fewer
 * badges — the user opening Settings while Ollama is stopped is precisely the user who needs to
 * reach the Ollama configuration panel.
 */
export function useOllamaModelMetrics(host?: string) {
  const [metrics, setMetrics] = useState<Record<string, OllamaModelMetrics>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!window.electronAPI?.getOllamaModelMetrics) {
        setLoaded(true)
        return
      }
      try {
        const result = await window.electronAPI.getOllamaModelMetrics(host)
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
  }, [host])

  return { metrics, loaded }
}
