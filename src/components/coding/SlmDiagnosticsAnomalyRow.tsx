import React from 'react'
import { AlertTriangle, AlertCircle, ShieldAlert, FileSearch } from 'lucide-react'
import type { SlmAnomalyRecord } from '../../types'

type Severity = 'CRITICAL' | 'ERROR' | 'WARNING'

export function getSeverityStyles(severity: string): { badge: string; icon: React.ReactNode } {
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

interface AnomalyRowProps {
  anomaly: SlmAnomalyRecord
  index: number
}

export const SlmDiagnosticsAnomalyRow: React.FC<AnomalyRowProps> = ({ anomaly, index }) => {
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
