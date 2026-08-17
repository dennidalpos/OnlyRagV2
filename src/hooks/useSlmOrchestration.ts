/**
 * src/hooks/useSlmOrchestration.ts
 *
 * Presentation Layer Hook — SLM Agent Studio Log Diagnostics
 *
 * Wraps window.electronAPI.agentLogsAnalyze() behind a clean React hook
 * interface with loading, error, and result state.
 *
 * Design decisions:
 *  - `lastReport` is preserved across calls so the UI can render the last
 *    known state without requiring re-fetch.
 *  - Errors are surfaced as typed `error: string | null`, never thrown,
 *    to keep the UI in full control of error presentation.
 */

import { useState, useCallback, useRef } from 'react'
import type { SlmLogDiagnosticReport } from '../types'

// ---------------------------------------------------------------------------
// Public hook types
// ---------------------------------------------------------------------------

export interface UseSlmOrchestrationReturn {
  // --- Log diagnostics state ---
  isAnalyzingLogs: boolean
  lastReport: SlmLogDiagnosticReport | null
  analyzeLogsError: string | null

  // --- Actions ---
  /**
   * Trigger log anomaly diagnostics scan.
   *
   * @param extraPaths  Optional additional log directories to include in scan.
   */
  analyzeLogs: (extraPaths?: string[]) => Promise<SlmLogDiagnosticReport | null>

  /** Reset all state (results, errors, loading flags). */
  reset: () => void
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useSlmOrchestration(): UseSlmOrchestrationReturn {
  // Log diagnostics state
  const [isAnalyzingLogs, setIsAnalyzingLogs] = useState(false)
  const [lastReport, setLastReport] = useState<SlmLogDiagnosticReport | null>(null)
  const [analyzeLogsError, setAnalyzeLogsError] = useState<string | null>(null)

  // Abort guard: prevent state update after unmount
  const mountedRef = useRef(true)
  // Note: we don't use useEffect cleanup here because the hook may be used
  // in long-lived views; instead we guard each setState call.

  const analyzeLogs = useCallback(
    async (extraPaths?: string[]): Promise<SlmLogDiagnosticReport | null> => {
      if (!window.electronAPI?.agentLogsAnalyze) {
        const msg = 'agentLogsAnalyze not available: ensure Electron preload is loaded.'
        setAnalyzeLogsError(msg)
        return null
      }

      setIsAnalyzingLogs(true)
      setAnalyzeLogsError(null)

      try {
        const report = await window.electronAPI.agentLogsAnalyze!(extraPaths)
        if (mountedRef.current) {
          setLastReport(report)
          if (!report) {
            setAnalyzeLogsError('Log analysis returned no report (sidecar offline?).')
          }
        }
        return report
      } catch (err: any) {
        const msg = err?.message ?? 'Unknown log analysis error'
        if (mountedRef.current) {
          setAnalyzeLogsError(msg)
        }
        return null
      } finally {
        if (mountedRef.current) {
          setIsAnalyzingLogs(false)
        }
      }
    },
    []
  )

  const reset = useCallback(() => {
    setIsAnalyzingLogs(false)
    setLastReport(null)
    setAnalyzeLogsError(null)
  }, [])

  return {
    isAnalyzingLogs,
    lastReport,
    analyzeLogsError,
    analyzeLogs,
    reset,
  }
}
