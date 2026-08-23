import React, { useState, useMemo } from 'react'
import { Code2, Loader2, ArrowDown, FolderOpen } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AgentActionLog, WorkspaceFile, CodingSession, InterviewQuestion, UserInterviewAnswer } from '../../types'
import { AgentPlan } from '../../hooks/usePlanApproval'
import { useTranslation } from '../../i18n'
import { AgentTimelineMessage } from './AgentTimelineMessage'
import { PlanInterviewCard } from './PlanInterviewCard'
import { PlanChatApprovalCard } from './PlanChatApprovalCard'
import { resolveWorkspaceQuickActions } from './workspaceQuickActions'

interface AgentTimelineProps {
  actionLogs: AgentActionLog[]
  activeSession?: CodingSession | null
  setAgentPrompt: (prompt: string) => void
  activeModelName?: string
  workspacePath?: string | null
  files?: WorkspaceFile[]
  onSelectWorkspaceFolder?: () => void
  onOpenFile?: (file: WorkspaceFile) => void
  onOpenRightTab?: (tab: 'editor' | 'terminal' | 'git_diff' | 'plan') => void
  isExecuting: boolean
  currentStep?: number
  maxSteps?: number | string
  streamingText: string
  currentStatusText?: string
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  bottomRef: React.RefObject<HTMLDivElement | null>
  isScrolledUp: boolean
  onScroll: () => void
  onScrollToBottom: () => void
  // Plan Flow Props
  plan?: AgentPlan | null
  isGeneratingPlan?: boolean
  countdownSeconds?: number
  isAutoProceedPaused?: boolean
  autoProceedEnabled?: boolean
  interviewQuestions?: InterviewQuestion[]
  isInterviewActive?: boolean
  isAnalyzingInterview?: boolean
  onConfirmInterview?: (answers: UserInterviewAnswer[]) => void
  onSkipInterview?: () => void
  onApprovePlan?: () => void
  onRejectPlan?: () => void
  onTogglePauseAutoProceed?: () => void
}

export const AgentTimeline: React.FC<AgentTimelineProps> = ({
  actionLogs,
  activeSession,
  setAgentPrompt,
  activeModelName,
  workspacePath,
  files = [],
  onSelectWorkspaceFolder,
  onOpenFile,
  onOpenRightTab,
  isExecuting,
  currentStep,
  maxSteps,
  streamingText,
  currentStatusText = '',
  scrollContainerRef,
  bottomRef,
  isScrolledUp,
  onScroll,
  onScrollToBottom,
  plan,
  isGeneratingPlan = false,
  countdownSeconds = 15,
  isAutoProceedPaused = false,
  autoProceedEnabled = true,
  interviewQuestions = [],
  isInterviewActive = false,
  isAnalyzingInterview = false,
  onConfirmInterview,
  onSkipInterview,
  onApprovePlan,
  onRejectPlan,
  onTogglePauseAutoProceed,
}) => {
  const { t } = useTranslation()
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set())

  const quickActions = useMemo(
    () => resolveWorkspaceQuickActions(workspacePath, files),
    [workspacePath, files]
  )

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Only the messages actually near the viewport are mounted: a long-running session can
  // accumulate hundreds of entries, and every one of them was previously kept in the DOM for
  // the life of the session. Item heights vary a lot (a one-line badge vs expanded output).
  const rowVirtualizer = useVirtualizer({
    count: actionLogs.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36,
    overscan: 10,
    getItemKey: (index) => actionLogs[index].id,
  })

  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto p-3 space-y-1.5 text-xs font-mono select-text relative"
    >
      {/* Floating Scroll-to-Bottom Button */}
      {isScrolledUp && (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="sticky bottom-2 ml-auto z-20 px-3 py-1.5 rounded-full bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 font-semibold text-xs shadow-xl flex items-center gap-1.5 transition-all focus-ring active:scale-95 cursor-pointer backdrop-blur-sm"
          aria-label="Scorri fino in fondo"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>In fondo</span>
        </button>
      )}

      {actionLogs.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-400 font-sans select-text">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-1 shadow-sm">
            <Code2 className="w-6 h-6" />
          </div>
          <div>
            <div className="font-semibold text-slate-200 text-sm">
              {(activeSession?.executedPrompts?.length ?? 0) > 0 ? activeSession?.title : t('coding.headerTitle')}
            </div>
            <p className="text-xs max-w-xs leading-relaxed text-slate-400 mt-1">
              {workspacePath ? t('coding.subtitle') : t('coding.noProjectAttached')}
            </p>
          </div>

          {!workspacePath && onSelectWorkspaceFolder ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={onSelectWorkspaceFolder}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/40 text-slate-200 hover:text-cyan-300 font-semibold rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm active:scale-95 focus-ring cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-cyan-400" />
                <span>{t('coding.selectFolder')}</span>
              </button>
            </div>
          ) : quickActions.length > 0 ? (
            <div className="w-full max-w-sm pt-3 space-y-1.5 text-left font-sans">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
                {t('common.actions')}
              </div>
              <div className="flex flex-col gap-1.5">
                {quickActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => setAgentPrompt(action.command)}
                    className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-[11px] text-slate-300 hover:text-cyan-200 transition-all text-left focus-ring active:scale-98 font-mono flex items-center justify-between cursor-pointer"
                  >
                    <span>{action.command}</span>
                    {action.description && (
                      <span className="text-[10px] font-sans text-slate-500">{action.description}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const log = actionLogs[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="pb-1.5">
                  <AgentTimelineMessage
                    log={log}
                    isExpanded={expandedLogIds.has(log.id)}
                    onToggleExpand={toggleExpand}
                    activeModelName={activeModelName}
                    onOpenFile={onOpenFile}
                    onOpenRightTab={onOpenRightTab}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pre-flight Clarification Interview Card (In-Chat) */}
      {isAnalyzingInterview && (
        <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 text-xs text-slate-200 space-y-2 shadow-xl animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
            <span className="font-semibold text-cyan-300">Analisi del Prompt &amp; Scelte Tecniche (Pre-Plan Interview)...</span>
          </div>
          <p className="text-[11px] text-slate-400">
            L'AI sta valutando se sono necessari chiarimenti preliminari per definire il piano ottimale.
          </p>
        </div>
      )}

      {isInterviewActive && interviewQuestions.length > 0 && (
        <div className="animate-in fade-in">
          <PlanInterviewCard
            questions={interviewQuestions}
            onConfirm={onConfirmInterview || (() => {})}
            onSkipWithRecommended={onSkipInterview || (() => {})}
            isGenerating={isGeneratingPlan}
          />
        </div>
      )}

      {/* Plan Generation State */}
      {isGeneratingPlan && (
        <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 text-xs text-slate-200 space-y-2 shadow-xl animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
            <span className="font-semibold text-cyan-300">Generazione del Piano di Esecuzione in corso...</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Delineazione delle milestone e delle verifiche passo-passo prima dell'esecuzione.
          </p>
        </div>
      )}

      {/* Plan Ready & Confirmation Card (In-Chat) */}
      {plan && plan.status === 'ready' && (
        <div className="animate-in fade-in">
          <PlanChatApprovalCard
            plan={plan}
            countdownSeconds={countdownSeconds}
            isAutoProceedPaused={isAutoProceedPaused}
            autoProceedEnabled={autoProceedEnabled}
            onTogglePauseAutoProceed={onTogglePauseAutoProceed || (() => {})}
            onApprove={onApprovePlan || (() => {})}
            onReject={onRejectPlan || (() => {})}
          />
        </div>
      )}

      {isExecuting && (
        <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs text-slate-200 font-sans shadow-lg animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
              <span className="font-semibold text-slate-100 truncate">
                {currentStatusText || `${t('coding.runTask')}...`}
              </span>
            </div>
            {currentStep !== undefined && currentStep > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-800/40 text-cyan-300 font-mono text-[10px] font-bold shrink-0 shadow-sm">
                Step {currentStep}{maxSteps ? ` / ${maxSteps}` : ''}
              </span>
            )}
          </div>
          {streamingText && (
            <div className="mt-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap max-h-48 leading-relaxed shadow-inner">
              {streamingText}
            </div>
          )}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
