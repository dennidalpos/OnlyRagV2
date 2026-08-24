import React, { useState, useEffect, useMemo } from 'react'
import { CheckCircle2, XCircle, Loader2, Sparkles, Copy, Check } from 'lucide-react'
import { AgentPlan } from '../../hooks/usePlanApproval'
import type { InterviewQuestion, UserInterviewAnswer } from '../../types'
import { parsePlanChecklist } from './planChecklistParser'
import { formatPromptForDisplay } from './promptFormatter'
import { PlanPanelHeader } from './PlanPanelHeader'
import { PlanPanelCountdownBanner } from './PlanPanelCountdownBanner'
import { PlanPanelChecklistView } from './PlanPanelChecklistView'
import { PlanPanelDocumentView } from './PlanPanelDocumentView'
import { PlanInterviewCard } from './PlanInterviewCard'

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
  interviewQuestions?: InterviewQuestion[]
  isInterviewActive?: boolean
  isAnalyzingInterview?: boolean
  onConfirmInterview?: (answers: UserInterviewAnswer[]) => void
  onSkipInterview?: () => void
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
  interviewQuestions = [],
  isInterviewActive = false,
  isAnalyzingInterview = false,
  onConfirmInterview,
  onSkipInterview,
  onApprove,
  onReject,
  onTogglePauseAutoProceed,
  onUpdatePlanText,
  completedStepCount = 0,
}) => {
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [editedText, setEditedText] = useState<string>('')
  const [viewMode, setViewMode] = useState<'checklist' | 'document'>('checklist')
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false)

  useEffect(() => {
    if (plan?.planText) {
      setEditedText(plan.planText)
    }
  }, [plan?.planText])

  const formattedPrompt = useMemo(() => formatPromptForDisplay(plan?.prompt), [plan?.prompt])

  const handleCopyPrompt = async () => {
    if (!plan?.prompt) return
    try {
      await navigator.clipboard.writeText(plan.prompt)
      setCopiedPrompt(true)
      setTimeout(() => setCopiedPrompt(false), 2000)
    } catch {
      // ignore
    }
  }

  const parsedChecklist = useMemo(() => parsePlanChecklist(plan), [plan?.planText, plan?.milestones])

  // Calculate items completed and active item status
  const totalItems = parsedChecklist.length

  const completedItemsCount = parsedChecklist.filter((item) => item.completed).length

  // Determine active item based on in_progress status or the first unfinished item when executing
  const inProgressIndex = parsedChecklist.findIndex((item) => item.status === 'in_progress')
  const firstUnfinishedIndex = parsedChecklist.findIndex((item) => !item.completed)
  const activeIndex = isExecuting
    ? (inProgressIndex !== -1 ? inProgressIndex : firstUnfinishedIndex)
    : -1

  const progressPercent = totalItems > 0 ? Math.round((completedItemsCount / totalItems) * 100) : 0

  const handleSaveEdit = () => {
    onUpdatePlanText(editedText)
    setIsEditing(false)
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-950 text-slate-200 select-text font-sans overflow-hidden">
      <PlanPanelHeader
        plan={plan}
        planHistory={planHistory}
        activePlanIndex={activePlanIndex}
        onSelectPlanVersion={onSelectPlanVersion}
        totalItems={totalItems}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode(viewMode === 'checklist' ? 'document' : 'checklist')}
      />

      {plan?.status === 'ready' && autoProceedEnabled && (
        <PlanPanelCountdownBanner
          countdownSeconds={countdownSeconds}
          isAutoProceedPaused={isAutoProceedPaused}
          onTogglePauseAutoProceed={onTogglePauseAutoProceed}
          onApprove={onApprove}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isAnalyzingInterview ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <div className="font-bold text-slate-200 text-xs">Analisi del Prompt &amp; Scelte Tecniche...</div>
            <p className="text-[11px] text-slate-400 max-w-xs">
              L'AI sta valutando se ci sono trade-off architetturali da confermare prima di generare la checklist.
            </p>
          </div>
        ) : isInterviewActive && interviewQuestions.length > 0 ? (
          <PlanInterviewCard
            questions={interviewQuestions}
            onConfirm={onConfirmInterview || (() => {})}
            onSkipWithRecommended={onSkipInterview || (() => {})}
            isGenerating={isGenerating}
          />
        ) : isGenerating ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <div className="font-bold text-slate-200 text-xs">Generazione del Piano (v{planHistory.length + 1}) in corso...</div>
            <p className="text-[11px] text-slate-400 max-w-xs">
              L'AI Agent sta analizzando il prompt per delineare la strategia di esecuzione passo-passo.
            </p>
          </div>
        ) : !plan ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-400">
            <Sparkles className="w-8 h-8 text-cyan-500/30" />
            <div className="font-semibold text-slate-400 text-xs">Nessun Piano Generato</div>
            <p className="text-[11px] text-slate-400 max-w-xs">
              Invia un prompt dall'editor per generare un piano d'azione e approvarlo prima dell'esecuzione.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* User Request Pill Box */}
            <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs space-y-2 shadow-sm">
              <div className="flex items-center justify-between text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
                <span>Richiesta Utente</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyPrompt}
                    title="Copia prompt"
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 font-mono text-[9px] lowercase transition-colors cursor-pointer"
                  >
                    {copiedPrompt ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">copiato</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-slate-400" />
                        <span>copia</span>
                      </>
                    )}
                  </button>
                  <span className="px-2 py-0.5 rounded-md bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 font-mono text-[9px]">
                    v{plan.version || activePlanIndex + 1}
                  </span>
                </div>
              </div>
              <div className="font-mono text-slate-200 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto p-2.5 bg-slate-950/80 rounded-xl border border-slate-800/80 select-text">
                {formattedPrompt || plan.prompt}
              </div>
            </div>

            {plan.status === 'approved' && viewMode === 'checklist' ? (
              <PlanPanelChecklistView
                version={plan.version}
                parsedChecklist={parsedChecklist}
                completedItemsCount={completedItemsCount}
                totalItems={totalItems}
                progressPercent={progressPercent}
                isExecuting={isExecuting}
                activeIndex={activeIndex}
              />
            ) : (
              <PlanPanelDocumentView
                plan={plan}
                isEditing={isEditing}
                editedText={editedText}
                onStartEdit={() => setIsEditing(true)}
                onCancelEdit={() => setIsEditing(false)}
                onChangeEditedText={setEditedText}
                onSaveEdit={handleSaveEdit}
              />
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
