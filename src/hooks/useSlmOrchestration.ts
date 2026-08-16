/**
 * src/hooks/useSlmOrchestration.ts
 *
 * Presentation Layer Hook — SLM Agent Studio Orchestration
 *
 * Wraps window.electronAPI.agentSlmOrchestrate() and agentLogsAnalyze()
 * behind a clean React hook interface with loading, error, and result state.
 *
 * Design decisions:
 *  - `useDefaultRegistry=true` by default: zero configuration required for
 *    standard Agent Studio usage (all 19 tools auto-populated server-side).
 *  - Separate `orchestrate` and `analyzeLogs` actions with independent state.
 *  - `lastResult` and `lastReport` are preserved across calls so the UI can
 *    render the last known state without requiring re-fetch.
 *  - All errors are surfaced as typed `error: string | null`, never thrown,
 *    to keep the UI in full control of error presentation.
 */

import { useState, useCallback, useRef } from 'react'
import type {
  SlmOrchestrationRequest,
  SlmOrchestrationResult,
  SlmLogDiagnosticReport,
} from '../types'

// ---------------------------------------------------------------------------
// Public hook types
// ---------------------------------------------------------------------------

export interface UseSlmOrchestrationOptions {
  /**
   * Ollama model tag to use, e.g. "qwen2.5:7b" or "llama3:8b".
   * Required on every orchestrate() call unless overridden per-call.
   */
  defaultModel?: string
  /**
   * When true (default), the sidecar auto-populates all 19 Agent Studio
   * tools from the server-side registry. Set false to pass a custom tool list.
   */
  useDefaultRegistry?: boolean
}

export interface OrchestrationCallOptions {
  /** Override the default model for this specific call. */
  model?: string
  /** Override the registry flag for this specific call. */
  useDefaultRegistry?: boolean
}

export interface UseSlmOrchestrationReturn {
  // --- Orchestration state ---
  isOrchestrating: boolean
  lastResult: SlmOrchestrationResult | null
  orchestrateError: string | null

  // --- Log diagnostics state ---
  isAnalyzingLogs: boolean
  lastReport: SlmLogDiagnosticReport | null
  analyzeLogsError: string | null

  // --- Actions ---
  /**
   * Execute one SLM agent turn via the Python sidecar state machine.
   *
   * @param userMessage  The user's instruction / task description.
   * @param overrides    Optional per-call overrides for model or registry flag.
   * @param partialReq   Optional partial request fields (history, rag_context, etc.).
   */
  orchestrate: (
    userMessage: string,
    overrides?: OrchestrationCallOptions,
    partialReq?: Partial<Omit<SlmOrchestrationRequest, 'model' | 'user_message' | 'use_default_registry'>>
  ) => Promise<SlmOrchestrationResult | null>

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

export function useSlmOrchestration(
  options: UseSlmOrchestrationOptions = {}
): UseSlmOrchestrationReturn {
  const { defaultModel = '', useDefaultRegistry = true } = options

  // Orchestration state
  const [isOrchestrating, setIsOrchestrating] = useState(false)
  const [lastResult, setLastResult] = useState<SlmOrchestrationResult | null>(null)
  const [orchestrateError, setOrchestrateError] = useState<string | null>(null)

  // Log diagnostics state
  const [isAnalyzingLogs, setIsAnalyzingLogs] = useState(false)
  const [lastReport, setLastReport] = useState<SlmLogDiagnosticReport | null>(null)
  const [analyzeLogsError, setAnalyzeLogsError] = useState<string | null>(null)

  // Abort guard: prevent state update after unmount
  const mountedRef = useRef(true)
  // Note: we don't use useEffect cleanup here because the hook may be used
  // in long-lived views; instead we guard each setState call.

  const orchestrate = useCallback(
    async (
      userMessage: string,
      overrides?: OrchestrationCallOptions,
      partialReq?: Partial<Omit<SlmOrchestrationRequest, 'model' | 'user_message' | 'use_default_registry'>>
    ): Promise<SlmOrchestrationResult | null> => {
      if (!window.electronAPI?.agentSlmOrchestrate) {
        const msg = 'agentSlmOrchestrate not available: ensure Electron preload is loaded.'
        setOrchestrateError(msg)
        return null
      }

      const resolvedModel = overrides?.model || defaultModel
      if (!resolvedModel) {
        const msg = 'No model specified. Provide defaultModel in options or override per call.'
        setOrchestrateError(msg)
        return null
      }

      const resolvedRegistry = overrides?.useDefaultRegistry ?? useDefaultRegistry

      setIsOrchestrating(true)
      setOrchestrateError(null)

      const request: SlmOrchestrationRequest = {
        model: resolvedModel,
        user_message: userMessage,
        use_default_registry: resolvedRegistry,
        tools: resolvedRegistry ? [] : (partialReq?.tools ?? []),
        history: partialReq?.history,
        rag_context: partialReq?.rag_context,
        max_context_tokens: partialReq?.max_context_tokens,
        max_retries: partialReq?.max_retries,
        few_shot_examples: partialReq?.few_shot_examples,
      }

      try {
        const result = await window.electronAPI.agentSlmOrchestrate!(request)
        if (mountedRef.current) {
          setLastResult(result)
          if (!result.success) {
            setOrchestrateError(
              result.error_detail
                ?? `Escalation: ${result.escalation_level} — ${result.text_response ?? 'No response'}`
            )
          }
        }
        return result
      } catch (err: any) {
        const msg = err?.message ?? 'Unknown orchestration error'
        if (mountedRef.current) {
          setOrchestrateError(msg)
        }
        return null
      } finally {
        if (mountedRef.current) {
          setIsOrchestrating(false)
        }
      }
    },
    [defaultModel, useDefaultRegistry]
  )

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
    setIsOrchestrating(false)
    setLastResult(null)
    setOrchestrateError(null)
    setIsAnalyzingLogs(false)
    setLastReport(null)
    setAnalyzeLogsError(null)
  }, [])

  return {
    isOrchestrating,
    lastResult,
    orchestrateError,
    isAnalyzingLogs,
    lastReport,
    analyzeLogsError,
    orchestrate,
    analyzeLogs,
    reset,
  }
}
