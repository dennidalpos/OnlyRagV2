/**
 * src/components/coding/SlmDiagnosticsPanel.tsx
 *
 * Presentation Layer — SLM Agent Studio Diagnostics Panel
 *
 * Displays anomaly diagnostic reports from the sidecar log analyzer.
 * Calls agentLogsAnalyze() via the useSlmOrchestration hook and renders
 * the SlmLogDiagnosticReport with per-anomaly severity badges, counters,
 * and an optional link to the diagnostics_report.json export path.
 *
 * Zero business logic: all data fetching is delegated to the hook.
 * Follows the same panel conventions as ActivitiesPanel (dark theme,
 * rounded-2xl cards, lucide-react icons, font-mono telemetry rows).
 */

import React, { useCallback } from 'react'
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ShieldAlert,
  RefreshCw,
  FileSearch,
  FileJson,
  CheckCircle2,
  ScanLine,
  Loader2,
} from 'lucide-react'
import { useSlmOrchestration } from '../../hooks/useSlmOrchestration'
import type { SlmAnomalyRecord, SlmLogDiagnosticReport } from '../../types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SlmDiagnosticsPanelProps {
  /** Optional additional log directory paths to scan. */
  extraLogPaths?: string[]
  /** Called when the user requests a manual re-scan. */
  onScanComplete?: (report: SlmLogDiagnosticReport | null) => void
}

// ---------------------------------------------------------------------------
// Severity badge helpers
// ---------------------------------------------------------------------------

type Severity = 'CRITICAL' | 'ERROR' | 'WARNING'

function getSeverityStyles(severity: string): { badge: string; icon: React.ReactNode } {
  switch (severity as Severity) {
    case 'CRITICAL':
      return {
        badge: 'bg-red-950 text-red-300 border border-red-700',
        icon: <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />,
      }
    case 'ERROR':
      return {
        badge: 'bg-amber-950 text-amber-300 border border-amber-700',
        icon: <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
      }
    case 'WARNING':
    default:
      return {
        badge: 'bg-yellow-950 text-yellow-300 border border-yellow-800',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />,
      }
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AnomalyRowProps {
  anomaly: SlmAnomalyRecord
  index: number
}

const AnomalyRow: React.FC<AnomalyRowProps> = ({ anomaly, index }) => {
  const { badge, icon } = getSeverityStyles(anomaly.severity)
  const shortFile = anomaly.log_file.replace(/^.*[/\\]/, '')

  return (
    <div
      className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1.5 animate-in fade-in"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Header row: type badge + severity + file:line */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-mono font-bold text-slate-200">{anomaly.anomaly_type}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider ${badge}`}>
            {anomaly.severity}
          </span>
          {anomaly.count > 1 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono font-bold border border-slate-700">
              ×{anomaly.count}
            </span>
          )}
        </div>
      </div>

      {/* File + line number */}
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
        <FileSearch className="w-3 h-3 shrink-0" />
        <span className="truncate" title={anomaly.log_file}>{shortFile}</span>
        <span className="text-slate-400">:</span>
        <span className="text-slate-400">L{anomaly.line_number}</span>
      </div>

      {/* Snippet */}
      {anomaly.snippet && (
        <div className="text-[10px] font-mono text-slate-400 bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800 truncate" title={anomaly.snippet}>
          {anomaly.snippet}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string
  value: string | number
  color: string
  icon: React.ReactNode
}

const StatCard: React.FC<StatCardProps> = ({ label, value, color, icon }) => (
  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2.5">
    <div className={`shrink-0 ${color}`}>{icon}</div>
    <div className="min-w-0">
      <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-400 truncate">{label}</div>
    </div>
  </div>
)

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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

  // Aggregate severity counts from the current report
  const criticalCount = lastReport?.anomalies.filter((a) => a.severity === 'CRITICAL').length ?? 0
  const errorCount = lastReport?.anomalies.filter((a) => a.severity === 'ERROR').length ?? 0
  const warningCount = lastReport?.anomalies.filter((a) => a.severity === 'WARNING').length ?? 0

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
        {lastReport && !isAnalyzingLogs && (
          <>
            {/* ── Summary stat row ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatCard
                label="File Scansionati"
                value={lastReport.scanned_files.length}
                color="text-slate-300"
                icon={<FileSearch className="w-4 h-4" />}
              />
              <StatCard
                label="Righe Analizzate"
                value={lastReport.total_lines_scanned.toLocaleString('it-IT')}
                color="text-slate-300"
                icon={<ScanLine className="w-4 h-4" />}
              />
              <StatCard
                label="Anomalie Totali"
                value={lastReport.anomalies.length}
                color={lastReport.anomalies.length > 0 ? 'text-amber-300' : 'text-emerald-300'}
                icon={<AlertTriangle className="w-4 h-4" />}
              />
              <StatCard
                label="Critici / Errori"
                value={`${criticalCount} / ${errorCount}`}
                color={criticalCount > 0 ? 'text-red-300' : errorCount > 0 ? 'text-amber-300' : 'text-emerald-300'}
                icon={<ShieldAlert className="w-4 h-4" />}
              />
            </div>

            {/* ── Severity breakdown bar ── */}
            {lastReport.anomalies.length > 0 && (
              <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Distribuzione Severity
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono font-bold">
                  {criticalCount > 0 && (
                    <span className="flex items-center gap-1 text-red-300">
                      <ShieldAlert className="w-3.5 h-3.5" /> {criticalCount} Critical
                    </span>
                  )}
                  {errorCount > 0 && (
                    <span className="flex items-center gap-1 text-amber-300">
                      <AlertCircle className="w-3.5 h-3.5" /> {errorCount} Error
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="flex items-center gap-1 text-yellow-300">
                      <AlertTriangle className="w-3.5 h-3.5" /> {warningCount} Warning
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Summary text ── */}
            <div
              className={`p-3.5 rounded-2xl border flex items-start gap-2.5 ${
                lastReport.has_critical
                  ? 'bg-red-950/30 border-red-800'
                  : lastReport.anomalies.length > 0
                  ? 'bg-amber-950/30 border-amber-800'
                  : 'bg-emerald-950/30 border-emerald-800'
              }`}
            >
              {lastReport.has_critical ? (
                <ShieldAlert className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              ) : lastReport.anomalies.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              )}
              <div className="space-y-0.5 min-w-0">
                <div className="text-xs font-bold text-slate-200">Riepilogo Analisi</div>
                <div className="text-[11px] font-mono text-slate-400 leading-relaxed break-words">
                  {lastReport.summary}
                </div>
              </div>
            </div>

            {/* ── Anomaly list ── */}
            {lastReport.anomalies.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  Anomalie Rilevate ({lastReport.anomalies.length})
                </div>
                {lastReport.anomalies.map((anomaly, i) => (
                  <AnomalyRow key={`${anomaly.log_file}-${anomaly.line_number}-${i}`} anomaly={anomaly} index={i} />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2.5 py-8 text-emerald-400 font-mono text-sm animate-in fade-in">
                <CheckCircle2 className="w-5 h-5" />
                <span>Nessuna anomalia rilevata — log puliti</span>
              </div>
            )}

            {/* ── Scanned files list ── */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 text-xs font-bold text-slate-200">
                <div className="flex items-center gap-2">
                  <FileJson className="w-4 h-4 text-cyan-400" />
                  <span>File di Log Scansionati</span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">{lastReport.scanned_files.length} file</span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {lastReport.scanned_files.map((filePath) => (
                  <div
                    key={filePath}
                    className="flex items-center gap-2 text-[10px] font-mono text-slate-400 hover:text-slate-200 transition-colors"
                    title={filePath}
                  >
                    <Info className="w-3 h-3 text-slate-600 shrink-0" />
                    <span className="truncate">{filePath}</span>
                  </div>
                ))}
                {lastReport.scanned_files.length === 0 && (
                  <div className="text-[11px] text-slate-400 font-mono italic">Nessun file di log trovato nei percorsi scansionati.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
