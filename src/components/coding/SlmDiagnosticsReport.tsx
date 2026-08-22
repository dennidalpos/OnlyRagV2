import React, { useState, useMemo } from 'react'
import {
  AlertTriangle,
  Info,
  ShieldAlert,
  FileSearch,
  FileJson,
  CheckCircle2,
  ScanLine,
  Search,
  Copy,
  Check,
  Filter,
} from 'lucide-react'
import type { SlmLogDiagnosticReport } from '../../types'
import { SlmDiagnosticsStatCard } from './SlmDiagnosticsStatCard'
import { SlmDiagnosticsAnomalyRow } from './SlmDiagnosticsAnomalyRow'

interface SlmDiagnosticsReportProps {
  lastReport: SlmLogDiagnosticReport
}

export const SlmDiagnosticsReport: React.FC<SlmDiagnosticsReportProps> = ({ lastReport }) => {
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'ERROR' | 'WARNING'>('ALL')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isCopied, setIsCopied] = useState<boolean>(false)

  const criticalCount = lastReport.anomalies.filter((a) => a.severity === 'CRITICAL').length
  const errorCount = lastReport.anomalies.filter((a) => a.severity === 'ERROR').length
  const warningCount = lastReport.anomalies.filter((a) => a.severity === 'WARNING').length

  const filteredAnomalies = useMemo(() => {
    return lastReport.anomalies.filter((a) => {
      if (severityFilter !== 'ALL' && a.severity !== severityFilter) {
        return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchType = a.anomaly_type.toLowerCase().includes(q)
        const matchFile = a.log_file.toLowerCase().includes(q)
        const matchSnippet = a.snippet?.toLowerCase().includes(q)
        const matchRemediation = a.remediation?.toLowerCase().includes(q)
        return matchType || matchFile || matchSnippet || matchRemediation
      }
      return true
    })
  }, [lastReport.anomalies, severityFilter, searchQuery])

  const handleCopyMarkdownReport = async () => {
    try {
      const mdLines: string[] = [
        `# SLM Diagnostics Report — OnlyRag V2`,
        `Data Generazione: ${new Date().toLocaleString('it-IT')}`,
        ``,
        `## 📊 Statistiche`,
        `- **File Scansionati**: ${lastReport.scanned_files.length}`,
        `- **Righe Analizzate**: ${lastReport.total_lines_scanned.toLocaleString('it-IT')}`,
        `- **Anomalie Totali**: ${lastReport.anomalies.length}`,
        `- **Critiche / Errori**: ${criticalCount} / ${errorCount}`,
        `- **Stato Generale**: ${lastReport.has_critical ? 'CRITICO' : lastReport.anomalies.length > 0 ? 'ATTENZIONE' : 'PULITO'}`,
        ``,
        `## 📝 Riepilogo`,
        lastReport.summary,
        ``,
        `## 🚨 Dettaglio Anomalie (${lastReport.anomalies.length})`,
      ]

      if (lastReport.anomalies.length === 0) {
        mdLines.push(`_Nessuna anomalia rilevata nei log._`)
      } else {
        lastReport.anomalies.forEach((a, idx) => {
          mdLines.push(`### ${idx + 1}. [${a.severity}] ${a.anomaly_type} (x${a.count})`)
          mdLines.push(`- **File**: \`${a.log_file}\` (Riga: ${a.line_number})`)
          if (a.snippet) {
            mdLines.push(`- **Snippet**: \`${a.snippet}\``)
          }
          if (a.remediation) {
            mdLines.push(`- **Suggerimento**: ${a.remediation}`)
          }
          mdLines.push(``)
        })
      }

      mdLines.push(`## 📁 File di Log Scansionati`)
      lastReport.scanned_files.forEach((f) => mdLines.push(`- \`${f}\``))

      await navigator.clipboard.writeText(mdLines.join('\n'))
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4">
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

      {/* ── Summary text & Action Bar ── */}
      <div
        className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
          lastReport.has_critical
            ? 'bg-red-950/30 border-red-800'
            : lastReport.anomalies.length > 0
            ? 'bg-amber-950/30 border-amber-800'
            : 'bg-emerald-950/30 border-emerald-800'
        }`}
      >
        <div className="flex items-start gap-2.5 min-w-0">
          {lastReport.has_critical ? (
            <ShieldAlert className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
          ) : lastReport.anomalies.length > 0 ? (
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
          )}
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-bold text-slate-200">Riepilogo Analisi Diagnostica</div>
            <div className="text-[11px] font-mono text-slate-300 leading-relaxed break-words">
              {lastReport.summary}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopyMarkdownReport}
          className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-slate-100 text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm active:scale-95"
          title="Copia report diagnostico completo in Markdown"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-semibold">Copiato!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Copia Report MD</span>
            </>
          )}
        </button>
      </div>

      {/* ── Interactive Filters & Search ── */}
      {lastReport.anomalies.length > 0 && (
        <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800/90 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Filtri per severity">
              <button
                type="button"
                onClick={() => setSeverityFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer ${
                  severityFilter === 'ALL'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                Tutti ({lastReport.anomalies.length})
              </button>

              {criticalCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSeverityFilter('CRITICAL')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer ${
                    severityFilter === 'CRITICAL'
                      ? 'bg-red-950 text-red-300 border border-red-700'
                      : 'bg-slate-900 text-red-400/70 border border-slate-800 hover:text-red-300'
                  }`}
                >
                  Critical ({criticalCount})
                </button>
              )}

              {errorCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSeverityFilter('ERROR')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer ${
                    severityFilter === 'ERROR'
                      ? 'bg-amber-950 text-amber-300 border border-amber-700'
                      : 'bg-slate-900 text-amber-400/70 border border-slate-800 hover:text-amber-300'
                  }`}
                >
                  Error ({errorCount})
                </button>
              )}

              {warningCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSeverityFilter('WARNING')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer ${
                    severityFilter === 'WARNING'
                      ? 'bg-yellow-950 text-yellow-300 border border-yellow-700'
                      : 'bg-slate-900 text-yellow-400/70 border border-slate-800 hover:text-yellow-300'
                  }`}
                >
                  Warning ({warningCount})
                </button>
              )}
            </div>

            {/* Search Input */}
            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtra anomalie o file..."
                className="w-full pl-8 pr-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-500 focus-ring"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Anomaly list ── */}
      {lastReport.anomalies.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span>Anomalie Visualizzate ({filteredAnomalies.length} di {lastReport.anomalies.length})</span>
            </div>
            {filteredAnomalies.length < lastReport.anomalies.length && (
              <span className="text-[10px] text-cyan-400 font-mono">Filtro attivo</span>
            )}
          </div>

          {filteredAnomalies.map((anomaly, i) => (
            <SlmDiagnosticsAnomalyRow
              key={`${anomaly.log_file}-${anomaly.line_number}-${i}`}
              anomaly={anomaly}
              index={i}
            />
          ))}

          {filteredAnomalies.length === 0 && (
            <div className="p-6 rounded-xl bg-slate-950/80 border border-slate-800 text-center text-xs font-mono text-slate-400 space-y-1">
              <Filter className="w-5 h-5 text-slate-600 mx-auto" />
              <div>Nessuna anomalia corrisponde ai criteri di ricerca selezionati.</div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2.5 py-8 text-emerald-400 font-mono text-sm bg-emerald-950/20 border border-emerald-800/40 rounded-2xl animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span>Nessuna anomalia rilevata — tutti i log di sistema sono puliti</span>
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
    </div>
  )
}
