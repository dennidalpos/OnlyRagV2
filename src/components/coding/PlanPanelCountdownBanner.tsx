import React from 'react'
import { Clock, Play, Pause, Zap } from 'lucide-react'

interface PlanPanelCountdownBannerProps {
  countdownSeconds: number
  isAutoProceedPaused: boolean
  onTogglePauseAutoProceed: () => void
  onApprove: () => void
}

export const PlanPanelCountdownBanner: React.FC<PlanPanelCountdownBannerProps> = ({
  countdownSeconds,
  isAutoProceedPaused,
  onTogglePauseAutoProceed,
  onApprove,
}) => {
  const countdownProgressPercent = Math.max(0, Math.min(100, ((15 - countdownSeconds) / 15) * 100))

  return (
    <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border-b border-amber-800/80 p-2.5 space-y-2 shrink-0 animate-in fade-in">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-amber-300 font-bold">
          <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
          <span>
            {isAutoProceedPaused
              ? 'Auto-proceed in pausa'
              : `Esecuzione automatica in ${countdownSeconds}s...`}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePauseAutoProceed}
            className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-amber-700/60 text-amber-300 text-[10px] font-semibold rounded-lg transition-all flex items-center gap-1 focus-ring"
          >
            {isAutoProceedPaused ? <Play className="w-3 h-3 text-emerald-400" /> : <Pause className="w-3 h-3 text-amber-400" />}
            <span>{isAutoProceedPaused ? 'Riprendi' : 'Pausa'}</span>
          </button>

          <button
            type="button"
            onClick={onApprove}
            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 shadow-md shadow-amber-950/50 focus-ring active:scale-95"
          >
            <Zap className="w-3 h-3 fill-current" /> Approva Ora
          </button>
        </div>
      </div>

      <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-amber-900/50">
        <div
          className={`h-full transition-all duration-1000 ${
            isAutoProceedPaused ? 'bg-amber-600/50' : 'bg-gradient-to-r from-amber-500 to-emerald-400'
          }`}
          style={{ width: `${100 - countdownProgressPercent}%` }}
        />
      </div>
    </div>
  )
}
