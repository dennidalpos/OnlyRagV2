import React from 'react'
import { FileCode } from 'lucide-react'
import { AgentChangeMetrics } from '../../types'

interface ChangeMetricsBarProps {
  changeMetrics?: AgentChangeMetrics
}

export const ChangeMetricsBar: React.FC<ChangeMetricsBarProps> = ({ changeMetrics }) => {
  if (!changeMetrics || changeMetrics.filesTouched === 0) return null

  return (
    <div className="mx-3 mb-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between text-[11px] text-slate-300">
      <span className="flex items-center gap-1.5 font-sans">
        <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        {changeMetrics.filesTouched} file modificat{changeMetrics.filesTouched === 1 ? 'o' : 'i'} in questa sessione
      </span>
      <span className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
        <span className="text-emerald-400">+{changeMetrics.additions}</span>
        <span className="text-rose-400">-{changeMetrics.deletions}</span>
      </span>
    </div>
  )
}
