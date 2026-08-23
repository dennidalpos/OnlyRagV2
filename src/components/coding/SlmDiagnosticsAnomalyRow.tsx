import React, { useState } from 'react'
import { AlertTriangle, AlertCircle, ShieldAlert, FileSearch, Lightbulb, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import type { SlmAnomalyRecord } from '../../types'

type Severity = 'CRITICAL' | 'ERROR' | 'WARNING'

function getSeverityStyles(severity: string): { badge: string; icon: React.ReactNode } {
  switch (severity as Severity) {
    case 'CRITICAL':
      return {
        badge: 'bg-red-950/80 text-red-300 border-red-700/70',
        icon: <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />,
      }
    case 'ERROR':
      return {
        badge: 'bg-amber-950/80 text-amber-300 border-amber-700/70',
        icon: <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />,
      }
    case 'WARNING':
    default:
      return {
        badge: 'bg-yellow-950/80 text-yellow-300 border-yellow-800/70',
        icon: <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />,
      }
  }
}

interface AnomalyRowProps {
  anomaly: SlmAnomalyRecord
  index: number
}

export const SlmDiagnosticsAnomalyRow: React.FC<AnomalyRowProps> = ({ anomaly, index }) => {
  const { badge, icon } = getSeverityStyles(anomaly.severity)
  const shortFile = anomaly.log_file.replace(/^.*[/\\]/, '')
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)

  const handleCopySnippet = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(anomaly.snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div
      className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 hover:border-slate-700 space-y-2.5 transition-all shadow-sm animate-in fade-in"
      style={{ animationDelay: `${index * 25}ms` }}
    >
      {/* Header row: type badge + severity + file:line */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-mono font-bold text-slate-100">{anomaly.anomaly_type}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider border ${badge}`}>
            {anomaly.severity}
          </span>
          {anomaly.count > 1 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono font-bold border border-slate-700">
              ×{anomaly.count}
            </span>
          )}
        </div>
      </div>

      {/* File path + line number */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileSearch className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="truncate text-slate-300 font-medium" title={anomaly.log_file}>{shortFile}</span>
          <span className="text-slate-600">:</span>
          <span className="text-cyan-400 font-bold">L{anomaly.line_number}</span>
        </div>

        {anomaly.snippet && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            <span>{isExpanded ? 'Comprimi' : 'Dettagli'}</span>
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Snippet / Log trace */}
      {anomaly.snippet && (
        <div className="relative group">
          <div
            className={`text-[10px] font-mono text-slate-300 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800/80 select-text ${
              isExpanded ? 'whitespace-pre-wrap max-h-56 overflow-y-auto' : 'truncate'
            }`}
            title={anomaly.snippet}
          >
            {anomaly.snippet}
          </div>
          <button
            type="button"
            onClick={handleCopySnippet}
            aria-label="Copia snippet di log"
            className="absolute top-1.5 right-1.5 p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-ring cursor-pointer"
            title="Copia snippet di log"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Remediation Tip */}
      {anomaly.remediation && (
        <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-[11px] text-amber-200 flex items-start gap-2">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-0.5 min-w-0">
            <span className="font-semibold text-amber-300">Suggerimento di Ripristino: </span>
            <span className="text-amber-200/90 leading-relaxed">{anomaly.remediation}</span>
          </div>
        </div>
      )}
    </div>
  )
}
