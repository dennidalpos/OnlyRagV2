import React from 'react'
import { FileText, ListCheck, Eye, ChevronLeft, ChevronRight, History } from 'lucide-react'
import { AgentPlan } from '../../hooks/usePlanApproval'

interface PlanPanelHeaderProps {
  plan: AgentPlan | null
  planHistory: AgentPlan[]
  activePlanIndex: number
  onSelectPlanVersion?: (index: number) => void
  totalItems: number
  viewMode: 'checklist' | 'document'
  onToggleViewMode: () => void
}

export const PlanPanelHeader: React.FC<PlanPanelHeaderProps> = ({
  plan,
  planHistory,
  activePlanIndex,
  onSelectPlanVersion,
  totalItems,
  viewMode,
  onToggleViewMode,
}) => {
  return (
    <div className="p-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
        <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
        <span>Piano &amp; Checklist Operativa</span>
      </div>

      {plan && (
        <div className="flex items-center gap-2">
          {/* Multi-Version Plan History Navigation Bar */}
          {planHistory.length > 1 && onSelectPlanVersion && (
            <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800 text-[10px] font-mono">
              <button
                type="button"
                disabled={activePlanIndex === 0}
                onClick={() => onSelectPlanVersion(activePlanIndex - 1)}
                className="p-0.5 hover:bg-slate-800 disabled:opacity-30 rounded text-slate-300 transition-colors"
                title="Versione precedente del piano"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <span className="font-bold text-cyan-300 px-1 flex items-center gap-1">
                <History className="w-3 h-3 text-cyan-400" />
                v{plan.version || activePlanIndex + 1}/{planHistory.length}
              </span>

              <button
                type="button"
                disabled={activePlanIndex === planHistory.length - 1}
                onClick={() => onSelectPlanVersion(activePlanIndex + 1)}
                className="p-0.5 hover:bg-slate-800 disabled:opacity-30 rounded text-slate-300 transition-colors"
                title="Versione successiva del piano"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {plan.status === 'approved' && totalItems > 0 && (
            <button
              type="button"
              onClick={onToggleViewMode}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold border border-slate-700 flex items-center gap-1 transition-colors"
              title="Alterna tra vista Checklist e Documento esteso"
            >
              {viewMode === 'checklist' ? <Eye className="w-3 h-3 text-cyan-400" /> : <ListCheck className="w-3 h-3 text-cyan-400" />}
              <span>{viewMode === 'checklist' ? 'Doc Esteso' : 'Checklist'}</span>
            </button>
          )}

          <span
            className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider ${
              plan.status === 'approved'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                : plan.status === 'generating'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800 animate-pulse'
                : plan.status === 'rejected'
                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                : 'bg-amber-950 text-amber-300 border border-amber-800'
            }`}
          >
            {plan.status === 'ready' ? 'In attesa di Approvazione' : plan.status}
          </span>
        </div>
      )}
    </div>
  )
}
