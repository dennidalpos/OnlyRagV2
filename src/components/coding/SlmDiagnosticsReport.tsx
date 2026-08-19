import React from 'react'
import { AlertTriangle, AlertCircle, Info, ShieldAlert, FileSearch, FileJson, CheckCircle2, ScanLine } from 'lucide-react'
import type { SlmLogDiagnosticReport } from '../../types'
import { SlmDiagnosticsStatCard } from './SlmDiagnosticsStatCard'
import { SlmDiagnosticsAnomalyRow } from './SlmDiagnosticsAnomalyRow'

interface SlmDiagnosticsReportProps {
  lastReport: SlmLogDiagnosticReport
}

export const SlmDiagnosticsReport: React.FC<SlmDiagnosticsReportProps> = ({ lastReport }) => {
  const criticalCount = lastReport.anomalies.filter((a) => a.severity === 'CRITICAL').length
  const errorCount = lastReport.anomalies.filter((a) => a.severity === 'ERROR').length
  const warningCount = lastReport.anomalies.filter((a) => a.severity === 'WARNING').length

  return (
    <>
      {/* ── Summary stat row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <SlmDiagnosticsStatCard
          label="File Scansionati"
          value={lastReport.scanned_files.length}
          color="text-slate-300"
          icon={<FileSearch className="w-4 h-4" />}
        />
        <SlmDiagnosticsStatCard
          label="Righe Analizzate"
          value={lastReport.total_lines_scanned.toLocaleString('it-IT')}
          color="text-slate-300"
          icon={<ScanLine className="w-4 h-4" />}
        />
        <SlmDiagnosticsStatCard
          label="Anomalie Totali"
          value={lastReport.anomalies.length}
          color={lastReport.anomalies.length > 0 ? 'text-amber-300' : 'text-emerald-300'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <SlmDiagnosticsStatCard
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
            <SlmDiagnosticsAnomalyRow key={`${anomaly.log_file}-${anomaly.line_number}-${i}`} anomaly={anomaly} index={i} />
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
  )
}
