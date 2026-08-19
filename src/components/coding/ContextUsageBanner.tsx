import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface ContextUsageBannerProps {
  isVisible: boolean
  estimatedTurnTokens: number
  maxContextLimit: number
  contextPercent: number
  isExecuting: boolean
  onCompactContext?: () => void
}

export const ContextUsageBanner: React.FC<ContextUsageBannerProps> = ({
  isVisible,
  estimatedTurnTokens,
  maxContextLimit,
  contextPercent,
  isExecuting,
  onCompactContext,
}) => {
  if (!isVisible) return null

  return (
    <div className="mx-3 mb-1.5 p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 flex items-center justify-between text-xs text-amber-300 animate-in fade-in">
      <div className="flex items-center gap-2 text-[11px] font-sans">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          Contesto turno: <strong>{estimatedTurnTokens.toLocaleString()}</strong> / {maxContextLimit.toLocaleString()} token stimati ({contextPercent}%)
        </span>
      </div>
      {onCompactContext && (
        <button
          type="button"
          disabled={isExecuting}
          onClick={onCompactContext}
          className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg text-[10px] transition-all active:scale-95 shadow-sm"
          title="Sintetizza e rimuovi i passaggi storici più vecchi mantenendo gli ultimi step"
        >
          🧹 Compatta Contesto
        </button>
      )}
    </div>
  )
}
