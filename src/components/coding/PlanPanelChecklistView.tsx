import React from 'react'
import { ListCheck, CheckCircle2, Circle, Loader2, Zap } from 'lucide-react'
import { PlanChecklistItem } from './planChecklistParser'

interface PlanPanelChecklistViewProps {
  version?: number
  parsedChecklist: PlanChecklistItem[]
  completedItemsCount: number
  totalItems: number
  progressPercent: number
  isExecuting: boolean
  activeIndex: number
}

export const PlanPanelChecklistView: React.FC<PlanPanelChecklistViewProps> = ({
  version,
  parsedChecklist,
  completedItemsCount,
  totalItems,
  progressPercent,
  isExecuting,
  activeIndex,
}) => {
  return (
    <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 shadow-md">
      {/* Checklist Progress Bar Banner */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <ListCheck className="w-4 h-4 text-emerald-400" />
          <span>Checklist Operativa (v{version})</span>
        </div>
        <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
          {completedItemsCount}/{totalItems} Completati ({progressPercent}%)
        </span>
      </div>

      {/* Progress Bar */}
      <div
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Avanzamento checklist operativa"
        className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800"
      >
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Checklist Items List (Read-Only driven by Agent Execution) */}
      <div className="space-y-2 pt-1">
        {parsedChecklist.map((item, idx) => {
          const isChecked = item.completed
          const isActive = isExecuting && !isChecked && (item.status === 'in_progress' || idx === activeIndex)

          return (
            <div
              key={item.id}
              className={`p-2.5 rounded-xl border text-xs flex items-start gap-2.5 transition-all select-text ${
                isChecked
                  ? 'bg-emerald-950/20 border-emerald-800/50 text-slate-300'
                  : isActive
                    ? 'bg-amber-950/30 border-amber-800/80 text-amber-200 shadow-sm'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-200'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isChecked ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 fill-emerald-950" />
                ) : isActive ? (
                  <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 text-slate-400 hover:text-cyan-400 transition-colors" />
                )}
              </div>

              <div className="flex-1 min-w-0 font-sans leading-relaxed">
                <span className={`text-[11px] ${isChecked ? 'line-through text-slate-400' : isActive ? 'font-bold text-amber-200' : 'text-slate-200 font-medium'}`}>
                  {item.title}
                </span>
              </div>

              {isActive ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/80 font-mono font-bold shrink-0 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5 text-amber-400 fill-current animate-pulse" /> IN CORSO
                </span>
              ) : item.tag ? (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-mono font-bold shrink-0">
                  {item.tag}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
