import React, { useState, useEffect } from 'react'
import {
  FileText,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  Edit3,
  Loader2,
  Clock,
  Sparkles,
  Zap,
} from 'lucide-react'
import { AgentPlan } from '../../hooks/usePlanApproval'
import { useTranslation } from '../../i18n'

interface PlanPanelProps {
  plan: AgentPlan | null
  isGenerating: boolean
  countdownSeconds: number
  isAutoProceedPaused: boolean
  autoProceedEnabled: boolean
  onApprove: () => void
  onReject: () => void
  onTogglePauseAutoProceed: () => void
  onUpdatePlanText: (newText: string) => void
}

export const PlanPanel: React.FC<PlanPanelProps> = ({
  plan,
  isGenerating,
  countdownSeconds,
  isAutoProceedPaused,
  autoProceedEnabled,
  onApprove,
  onReject,
  onTogglePauseAutoProceed,
  onUpdatePlanText,
}) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [editedText, setEditedText] = useState<string>('')

  useEffect(() => {
    if (plan?.planText) {
      setEditedText(plan.planText)
    }
  }, [plan?.planText])

  const handleSaveEdit = () => {
    onUpdatePlanText(editedText)
    setIsEditing(false)
  }

  const progressPercent = Math.max(0, Math.min(100, ((15 - countdownSeconds) / 15) * 100))

  return (
    <div className="flex-1 h-full flex flex-col bg-[#090d16] text-slate-200 select-text font-sans overflow-hidden">
      {/* Top Header */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <FileText className="w-4 h-4 text-cyan-400" />
          <span>Piano di Implementazione Agent</span>
        </div>

        {plan && (
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
        )}
      </div>

      {/* Auto-Proceed Countdown Banner (if enabled and status ready) */}
      {plan?.status === 'ready' && autoProceedEnabled && (
        <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border-b border-amber-800/80 p-3 space-y-2 shrink-0 animate-in fade-in">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-amber-300 font-bold">
              <Clock className="w-4 h-4 text-amber-400 animate-spin" />
              <span>
                {isAutoProceedPaused
                  ? 'Auto-proceed in pausa'
                  : `Esecuzione automatica in ${countdownSeconds}s...`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onTogglePauseAutoProceed}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-amber-700/60 text-amber-300 text-[11px] font-semibold rounded-lg transition-all flex items-center gap-1 focus-ring"
              >
                {isAutoProceedPaused ? <Play className="w-3 h-3 text-emerald-400" /> : <Pause className="w-3 h-3 text-amber-400" />}
                <span>{isAutoProceedPaused ? 'Riprendi' : 'Pausa'}</span>
              </button>

              <button
                type="button"
                onClick={onApprove}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 shadow-md shadow-amber-950/50 focus-ring active:scale-95"
              >
                <Zap className="w-3 h-3 fill-current" /> Approva Ora
              </button>
            </div>
          </div>

          {/* Countdown Progress Bar */}
          <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-amber-900/50">
            <div
              className={`h-full transition-all duration-1000 ${
                isAutoProceedPaused ? 'bg-amber-600/50' : 'bg-gradient-to-r from-amber-500 to-emerald-400'
              }`}
              style={{ width: `${100 - progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Plan Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isGenerating ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3 text-slate-400">
            <Loader2 className="w-10 h-10 animate-spin text-cyan-400" />
            <div className="font-bold text-slate-200 text-sm">Generazione del Piano in corso...</div>
            <p className="text-xs text-slate-500 max-w-sm">
              L'AI Agent sta analizzando il prompt per delineare la strategia di esecuzione passo-passo.
            </p>
          </div>
        ) : !plan ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3 text-slate-500">
            <Sparkles className="w-10 h-10 text-cyan-500/30" />
            <div className="font-semibold text-slate-400 text-sm">Nessun Piano Generato</div>
            <p className="text-xs text-slate-500 max-w-sm">
              Invia un prompt dall'editor per generare un piano d'azione e approvarlo prima dell'esecuzione.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* User Prompt Reference Box */}
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
              <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Richiesta Utente</div>
              <div className="font-mono text-slate-200 leading-relaxed">{plan.prompt}</div>
            </div>

            {/* Plan Content Document */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" /> Artefatto Piano d'Azione
                </span>

                {!isEditing && plan.status === 'ready' && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-medium rounded-lg flex items-center gap-1 transition-colors"
                  >
                    <Edit3 className="w-3 h-3 text-cyan-400" /> Modifica Piano
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    rows={12}
                    className="w-full bg-slate-900 border border-cyan-500/60 rounded-xl p-3 text-xs font-mono text-slate-100 outline-none leading-relaxed resize-y"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs font-semibold rounded-lg"
                    >
                      Annulla
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg"
                    >
                      Salva Modifiche
                    </button>
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap font-mono text-xs text-slate-200 leading-relaxed p-2 bg-slate-900/50 rounded-xl border border-slate-900">
                  {plan.planText}
                </div>
              )}
            </div>

            {/* Action Bar (Approve / Reject) */}
            {plan.status === 'ready' && (
              <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3 shadow-2xl">
                <button
                  type="button"
                  onClick={onReject}
                  className="px-4 py-2 bg-slate-950 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-800/80 text-rose-300 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 focus-ring"
                >
                  <XCircle className="w-4 h-4 text-rose-400" /> Rifiuta
                </button>

                <button
                  type="button"
                  onClick={onApprove}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-slate-950 text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/50 focus-ring active:scale-95"
                >
                  <CheckCircle2 className="w-4 h-4 fill-current" /> Approva &amp; Esegui Task
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
