import React, { useState, useEffect, useMemo } from 'react'
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
  ListCheck,
  Circle,
  Eye,
  ChevronLeft,
  ChevronRight,
  History,
} from 'lucide-react'
import { AgentPlan } from '../../hooks/usePlanApproval'
import { useTranslation } from '../../i18n'

export interface PlanChecklistItem {
  id: string
  title: string
  completed: boolean
  tag?: string
}

interface PlanPanelProps {
  plan: AgentPlan | null
  planHistory?: AgentPlan[]
  activePlanIndex?: number
  onSelectPlanVersion?: (index: number) => void
  isGenerating: boolean
  isExecuting?: boolean
  countdownSeconds: number
  isAutoProceedPaused: boolean
  autoProceedEnabled: boolean
  onApprove: () => void
  onReject: () => void
  onTogglePauseAutoProceed: () => void
  onUpdatePlanText: (newText: string) => void
  completedStepCount?: number
}

export const PlanPanel: React.FC<PlanPanelProps> = ({
  plan,
  planHistory = [],
  activePlanIndex = 0,
  onSelectPlanVersion,
  isGenerating,
  isExecuting = false,
  countdownSeconds,
  isAutoProceedPaused,
  autoProceedEnabled,
  onApprove,
  onReject,
  onTogglePauseAutoProceed,
  onUpdatePlanText,
  completedStepCount = 0,
}) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [editedText, setEditedText] = useState<string>('')
  const [viewMode, setViewMode] = useState<'checklist' | 'document'>('checklist')
  const [manualCompletedIds, setManualCompletedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (plan?.planText) {
      setEditedText(plan.planText)
    }
  }, [plan?.planText])

  // Parse plan text into structured checklist items
  const parsedChecklist = useMemo<PlanChecklistItem[]>(() => {
    if (!plan?.planText) return []

    const lines = plan.planText.split(/\r?\n/)
    const items: PlanChecklistItem[] = []
    let counter = 1

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      // Match markdown checklist "- [ ] Step" or "- [x] Step"
      const checkMatch = line.match(/^(?:[-*]|\d+\.)\s*\[([ xX>!])\]\s*(.+)$/)
      if (checkMatch) {
        const flag = checkMatch[1].toLowerCase()
        const body = checkMatch[2].replace(/\*\*/g, '').trim()
        items.push({
          id: `item-${counter++}`,
          title: body,
          completed: flag === 'x',
        })
        continue
      }

      // Match numbered points "1. Step" or "1) Step"
      const numMatch = line.match(/^(\d+)[\.\)]\s+(.+)$/)
      if (numMatch) {
        const body = numMatch[2].replace(/\*\*/g, '').trim()
        items.push({
          id: `item-${counter++}`,
          title: body,
          completed: false,
        })
        continue
      }

      // Match markdown headers with emojis e.g. "### ✏️ Modifiche"
      const headerMatch = line.match(/^#{1,4}\s+(.+)$/)
      if (headerMatch) {
        const body = headerMatch[1].replace(/\*\*/g, '').trim()
        if (body.length > 3) {
          items.push({
            id: `item-${counter++}`,
            title: body,
            completed: false,
            tag: 'FASE',
          })
        }
      }
    }

    // Fallback if no structured points found
    if (items.length === 0 && plan.planText.trim().length > 0) {
      items.push({
        id: 'item-1',
        title: 'Analisi requisiti e contesto di progetto',
        completed: false,
      })
      items.push({
        id: 'item-2',
        title: 'Implementazione delle modifiche richieste',
        completed: false,
      })
      items.push({
        id: 'item-3',
        title: 'Verifica e test finale di correttezza',
        completed: false,
      })
    }

    return items
  }, [plan?.planText])

  const toggleItemCompletion = (id: string) => {
    setManualCompletedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Calculate items completed and active item status
  const totalItems = parsedChecklist.length

  // Calculate relative steps executed for this specific plan version
  const baseOffset = plan?.baseStepOffset || 0
  const stepsForThisPlan = Math.max(0, completedStepCount - baseOffset)

  // Determine auto-step completed index based on execution state.
  // During active execution or paused state (e.g. Circuit Breaker), items track actual progress without falsely marking 100% completion.
  let autoStepCompletedIndex = 0
  if (isExecuting && stepsForThisPlan > 0) {
    autoStepCompletedIndex = Math.min(totalItems, stepsForThisPlan - 1)
  } else if (plan?.status === 'approved' && stepsForThisPlan > 0) {
    autoStepCompletedIndex = Math.min(Math.max(0, totalItems - 1), stepsForThisPlan - 1)
  }

  const completedItemsCount = parsedChecklist.reduce((acc, item, idx) => {
    const isManuallyChecked = manualCompletedIds.has(item.id)
    if (item.completed || isManuallyChecked || idx < autoStepCompletedIndex) return acc + 1
    return acc
  }, 0)

  const activeIndex = isExecuting && autoStepCompletedIndex < totalItems
    ? autoStepCompletedIndex
    : -1

  const progressPercent = totalItems > 0 ? Math.round((completedItemsCount / totalItems) * 100) : 0
  const countdownProgressPercent = Math.max(0, Math.min(100, ((15 - countdownSeconds) / 15) * 100))

  const handleSaveEdit = () => {
    onUpdatePlanText(editedText)
    setIsEditing(false)
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b0f17] text-slate-200 select-text font-sans overflow-hidden">
      {/* Uniform Panel Top Header */}
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
                onClick={() => setViewMode(viewMode === 'checklist' ? 'document' : 'checklist')}
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

      {/* Auto-Proceed Countdown Banner (if enabled and status ready) */}
      {plan?.status === 'ready' && autoProceedEnabled && (
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
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isGenerating ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <div className="font-bold text-slate-200 text-xs">Generazione del Piano (v{planHistory.length + 1}) in corso...</div>
            <p className="text-[11px] text-slate-500 max-w-xs">
              L'AI Agent sta analizzando il prompt per delineare la strategia di esecuzione passo-passo.
            </p>
          </div>
        ) : !plan ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-500">
            <Sparkles className="w-8 h-8 text-cyan-500/30" />
            <div className="font-semibold text-slate-400 text-xs">Nessun Piano Generato</div>
            <p className="text-[11px] text-slate-500 max-w-xs">
              Invia un prompt dall'editor per generare un piano d'azione e approvarlo prima dell'esecuzione.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* User Request Pill Box */}
            <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
              <div className="flex items-center justify-between text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
                <span>Richiesta Utente</span>
                <span>Versione {plan.version || activePlanIndex + 1}</span>
              </div>
              <div className="font-mono text-slate-200 text-[11px] leading-relaxed">{plan.prompt}</div>
            </div>

            {/* If Approved & Checklist View Mode: Render Dynamic Operational Checklist */}
            {plan.status === 'approved' && viewMode === 'checklist' ? (
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 shadow-xl">
                {/* Checklist Progress Bar Banner */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <ListCheck className="w-4 h-4 text-emerald-400" />
                    <span>Checklist Operativa (v{plan.version})</span>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                    {completedItemsCount}/{totalItems} Completati ({progressPercent}%)
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Checklist Items List */}
                <div className="space-y-2 pt-1">
                  {parsedChecklist.map((item, idx) => {
                    const isManuallyChecked = manualCompletedIds.has(item.id)
                    const isChecked =
                      item.completed ||
                      isManuallyChecked ||
                      idx < autoStepCompletedIndex

                    const isActive = isExecuting && !isChecked && idx === activeIndex

                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleItemCompletion(item.id)}
                        className={`p-2.5 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-all ${
                          isChecked
                            ? 'bg-emerald-950/20 border-emerald-800/50 text-slate-300'
                            : isActive
                              ? 'bg-amber-950/30 border-amber-800/80 text-amber-200 shadow-sm'
                              : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800/80 text-slate-200'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          {isChecked ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 fill-emerald-950" />
                          ) : isActive ? (
                            <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-500 hover:text-cyan-400 transition-colors" />
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
            ) : (
              /* Extended Plan Text Document View */
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" /> Artefatto Piano v{plan.version}
                  </span>

                  {!isEditing && plan.status === 'ready' && (
                    <button
                      onClick={() => setIsEditing(true)}
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
                      onChange={(e) => setEditedText(e.target.value)}
                      rows={10}
                      className="w-full bg-slate-900 border border-cyan-500/60 rounded-xl p-3 text-xs font-mono text-slate-100 outline-none leading-relaxed resize-y"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs font-semibold rounded-lg"
                      >
                        Annulla
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg"
                      >
                        Salva
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap font-mono text-xs text-slate-200 leading-relaxed p-2.5 bg-slate-900/50 rounded-xl border border-slate-900/80">
                    {plan.planText}
                  </div>
                )}
              </div>
            )}

            {/* Action Bar (Approve / Reject) */}
            {plan.status === 'ready' && (
              <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2 shadow-2xl">
                <button
                  type="button"
                  onClick={onReject}
                  className="px-3.5 py-2 bg-slate-950 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-800/80 text-rose-300 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 focus-ring"
                >
                  <XCircle className="w-3.5 h-3.5 text-rose-400" /> Rifiuta
                </button>

                <button
                  type="button"
                  onClick={onApprove}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-slate-950 text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/50 focus-ring active:scale-95"
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
