import React from 'react'
import { FileText, Edit3 } from 'lucide-react'
import { AgentPlan } from '../../hooks/usePlanApproval'

interface PlanPanelDocumentViewProps {
  plan: AgentPlan
  isEditing: boolean
  editedText: string
  onStartEdit: () => void
  onCancelEdit: () => void
  onChangeEditedText: (text: string) => void
  onSaveEdit: () => void
}

export const PlanPanelDocumentView: React.FC<PlanPanelDocumentViewProps> = ({
  plan,
  isEditing,
  editedText,
  onStartEdit,
  onCancelEdit,
  onChangeEditedText,
  onSaveEdit,
}) => {
  return (
    <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2.5 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" /> Artefatto Piano v{plan.version}
        </span>

        {!isEditing && plan.status === 'ready' && (
          <button
            type="button"
            onClick={onStartEdit}
            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-medium rounded-lg flex items-center gap-1 transition-colors"
          >
            <Edit3 className="w-3 h-3 text-cyan-400" /> Modifica
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editedText}
            onChange={(e) => onChangeEditedText(e.target.value)}
            rows={10}
            aria-label="Testo del piano"
            className="w-full bg-slate-950 border border-cyan-500/60 rounded-xl p-3 text-xs font-mono text-slate-100 outline-none leading-relaxed resize-y"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs font-semibold rounded-lg"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={onSaveEdit}
              className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-cyan-950/40"
            >
              Salva
            </button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap font-mono text-xs text-slate-200 leading-relaxed p-2.5 bg-slate-950/70 rounded-xl border border-slate-800/80">
          {plan.planText}
        </div>
      )}
    </div>
  )
}
