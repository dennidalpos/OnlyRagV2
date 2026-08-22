import React, { useState, useMemo } from 'react'
import { CheckCircle2, XCircle, Sparkles, ListChecks, FileText } from 'lucide-react'
import type { AgentPlan } from '../../hooks/usePlanApproval'
import { parsePlanChecklist } from './planChecklistParser'
import { PlanPanelCountdownBanner } from './PlanPanelCountdownBanner'

interface PlanChatApprovalCardProps {
  plan: AgentPlan
  countdownSeconds: number
  isAutoProceedPaused: boolean
  autoProceedEnabled: boolean
  onTogglePauseAutoProceed: () => void
  onApprove: () => void
  onReject: () => void
}

export const PlanChatApprovalCard: React.FC<PlanChatApprovalCardProps> = ({
  plan,
  countdownSeconds,
  isAutoProceedPaused,
  autoProceedEnabled,
  onTogglePauseAutoProceed,
  onApprove,
  onReject,
}) => {
  const [viewMode, setViewMode] = useState<'checklist' | 'document'>('checklist')
  const parsedChecklist = useMemo(() => parsePlanChecklist(plan), [plan.planText, plan.milestones])

  return (
    <div className="p-4 rounded-2xl bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-cyan-500/40 shadow-2xl space-y-3.5 text-xs select-text animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-100 text-xs">Piano d'Azione Proposto</span>
              <span className="px-1.5 py-0.2 rounded bg-cyan-950/80 border border-cyan-700/50 text-cyan-300 text-[10px] font-mono font-semibold">
                v{plan.version}
              </span>
            </div>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setViewMode('checklist')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-1 ${
              viewMode === 'checklist'
                ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListChecks className="w-3 h-3" />
            <span>Checklist</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('document')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-1 ${
              viewMode === 'document'
                ? 'bg-cyan-950 border border-cyan-700/60 text-cyan-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3 h-3" />
            <span>Doc</span>
          </button>
        </div>
      </div>

      {/* User prompt context */}
      {plan.prompt && (
        <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/90 text-slate-300">
          <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider block mb-1">Obiettivo</span>
          <p className="font-mono text-[11px] leading-relaxed text-slate-200">{plan.prompt}</p>
        </div>
      )}

      {/* Auto Proceed Countdown Banner */}
      {autoProceedEnabled && (
        <PlanPanelCountdownBanner
          countdownSeconds={countdownSeconds}
          isAutoProceedPaused={isAutoProceedPaused}
          onTogglePauseAutoProceed={onTogglePauseAutoProceed}
          onApprove={onApprove}
        />
      )}

      {/* Content Preview */}
      <div className="max-h-60 overflow-y-auto pr-1 space-y-2">
        {viewMode === 'checklist' && parsedChecklist.length > 0 ? (
          <div className="space-y-1.5">
            {parsedChecklist.map((item, idx) => (
              <div
                key={item.id || idx}
                className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5 text-[11px]"
              >
                <div className="w-4 h-4 rounded-full bg-cyan-950/80 border border-cyan-700/60 flex items-center justify-center text-cyan-300 text-[9px] font-bold shrink-0 mt-0.5">
                  {idx + 1}
                </div>
                <span className="text-slate-200 font-sans leading-relaxed">{item.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/80 font-mono text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">
            {plan.planText}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onReject}
          aria-label="Rifiuta piano"
          className="px-3.5 py-1.5 rounded-xl bg-slate-950 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-800/80 text-rose-300 text-xs font-semibold transition-all focus-ring flex items-center gap-1.5 active:scale-95 cursor-pointer"
        >
          <XCircle className="w-3.5 h-3.5 text-rose-400" />
          <span>Rifiuta</span>
        </button>

        <button
          type="button"
          onClick={onApprove}
          aria-label="Conferma ed esegui piano"
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-950/50 transition-all focus-ring flex items-center gap-2 active:scale-95 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4 fill-current" />
          <span>Conferma e Procedi</span>
        </button>
      </div>
    </div>
  )
}
