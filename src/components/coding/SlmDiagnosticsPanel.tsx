/**
 * src/components/coding/SlmDiagnosticsPanel.tsx
 *
 * Presentation Layer — SLM Agent Studio Diagnostics Panel
 *
 * Displays anomaly diagnostic reports from the sidecar log analyzer.
 * Calls agentLogsAnalyze() via the useSlmOrchestration hook; the report body
 * itself (stat cards, severity breakdown, anomaly list, scanned files) lives
 * in SlmDiagnosticsReport, this file only owns the header and loading/error/
 * empty states.
 *
 * Zero business logic: all data fetching is delegated to the hook.
 * Follows OnlyRag V2 panel design conventions (dark theme,
 * rounded-2xl cards, lucide-react icons, font-mono telemetry rows).
 */

import React, { useCallback, useEffect } from 'react'
import { AlertCircle, RefreshCw, ScanLine, Loader2 } from 'lucide-react'
import { useSlmOrchestration } from '../../hooks/useSlmOrchestration'
import type { SlmLogDiagnosticReport } from '../../types'
import { SlmDiagnosticsReport } from './SlmDiagnosticsReport'

export interface SlmDiagnosticsPanelProps {
  /** Optional additional log directory paths to scan. */
  extraLogPaths?: string[]
  /** Called when the user requests a manual re-scan. */
  onScanComplete?: (report: SlmLogDiagnosticReport | null) => void
}

export const SlmDiagnosticsPanel: React.FC<SlmDiagnosticsPanelProps> = ({
  extraLogPaths,
  onScanComplete,
}) => {
  const { isAnalyzingLogs, lastReport, analyzeLogsError, analyzeLogs } =
    useSlmOrchestration()

  const handleScan = useCallback(async () => {
    const report = await analyzeLogs(extraLogPaths)
    onScanComplete?.(report)
  }, [analyzeLogs, extraLogPaths, onScanComplete])

  // Auto-scan on mount if no report is currently loaded
  useEffect(() => {
    if (!lastReport && !isAnalyzingLogs && !analyzeLogsError) {
      handleScan()
    }
  }, [lastReport, isAnalyzingLogs, analyzeLogsError, handleScan])

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b0f17] select-text font-sans text-slate-200 overflow-y-auto">

      {/* ── Panel Header ── */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0 sticky top-0 z-10 backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <ScanLine className="w-4 h-4 text-amber-400 shrink-0" />
          <span>SLM Diagnostica Log</span>
        </div>

        <div className="flex items-center gap-2">
          {lastReport?.has_critical && (
            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider bg-red-950 text-red-300 border border-red-700 animate-pulse">
              CRITICAL
            </span>
          )}
          {lastReport && !lastReport.has_critical && (
            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-800">
              CLEAN
            </span>
          )}

          <button
            type="button"
            id="slm-diagnostics-scan-btn"
            onClick={handleScan}
            disabled={isAnalyzingLogs}
            title="Avvia scansione anomalie log"
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-700/50 hover:bg-amber-500/25 hover:border-amber-600 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzingLogs ? 'animate-spin' : ''}`} />
            {isAnalyzingLogs ? 'Analisi...' : 'Scansiona'}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="p-4 space-y-4 max-w-4xl w-full mx-auto">

        {/* Loading state */}
        {isAnalyzingLogs && (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400 font-mono animate-in fade-in">
            <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
            <span>Scansione log in corso...</span>
          </div>
        )}

        {/* Error state */}
        {analyzeLogsError && !isAnalyzingLogs && (
          <div className="p-4 rounded-2xl bg-red-950/40 border border-red-800 flex items-start gap-3 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <div className="text-xs font-bold text-red-300">Errore analisi log</div>
              <div className="text-[11px] font-mono text-red-400/80">{analyzeLogsError}</div>
            </div>
          </div>
        )}

        {/* Empty state (no scan yet) */}
        {!isAnalyzingLogs && !lastReport && !analyzeLogsError && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400 animate-in fade-in">
            <ScanLine className="w-10 h-10 text-slate-700" />
            <div className="text-sm font-bold text-slate-400">Nessun report disponibile</div>
            <div className="text-[11px] text-slate-400 text-center max-w-xs leading-relaxed">
              Avvia una scansione per rilevare anomalie nei log di OnlyRag V2 (CUDA OOM, tool loop, JSON troncati).
            </div>
            <button
              type="button"
              id="slm-diagnostics-empty-scan-btn"
              onClick={handleScan}
              className="mt-2 flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-700/50 hover:bg-amber-500/25 hover:border-amber-600 active:scale-95 transition-all duration-150"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Avvia Prima Scansione
            </button>
          </div>
        )}

        {/* Report content */}
        {lastReport && !isAnalyzingLogs && <SlmDiagnosticsReport lastReport={lastReport} />}
      </div>
    </div>
  )
}
