import React from 'react'
import { FileText } from 'lucide-react'
import { AgentPlan } from '../../hooks/usePlanApproval'
import { renderAgentPlanMarkdown } from '../../../shared/domain/agent/planCompilation'

interface PlanPanelDocumentViewProps {
  plan: AgentPlan
}

export const PlanPanelDocumentView: React.FC<PlanPanelDocumentViewProps> = ({ plan }) => {
  return (
    <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2.5 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" /> Artefatto Piano v{plan.version}
        </span>
      </div>
      <div className="whitespace-pre-wrap font-mono text-xs text-slate-200 leading-relaxed p-2.5 bg-slate-950/70 rounded-xl border border-slate-800/80">
        {renderAgentPlanMarkdown(plan)}
      </div>
    </div>
  )
}
