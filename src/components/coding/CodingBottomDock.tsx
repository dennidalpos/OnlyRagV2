import React, { useState } from 'react'
import {
  Terminal,
  FileText,
  GitBranch,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { AppSettings } from '../../types'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { usePlanApproval } from '../../hooks/usePlanApproval'
import { useTranslation } from '../../i18n'
import { CodingTerminal } from './CodingTerminal'
import { PlanPanel } from './PlanPanel'
import { GitDiffPanel } from './GitDiffPanel'

export type BottomDockTab = 'terminal' | 'git_diff' | 'plan'

interface CodingBottomDockProps {
  isOpen: boolean
  onToggleOpen: () => void
  activeDockTab: BottomDockTab
  setActiveDockTab: (tab: BottomDockTab) => void
  c: ReturnType<typeof useCodingAgent>
  planApproval: ReturnType<typeof usePlanApproval>
  settings?: AppSettings
  activeModelName: string
  autoScroll: boolean
  height: number
  isResizing?: boolean
  onMouseDownResize?: (e: React.MouseEvent) => void
}

export const CodingBottomDock: React.FC<CodingBottomDockProps> = ({
  isOpen,
  onToggleOpen,
  activeDockTab,
  setActiveDockTab,
  c,
  planApproval,
  settings,
  activeModelName: _activeModelName,
  autoScroll,
  height,
  isResizing,
  onMouseDownResize,
}) => {
  const { t } = useTranslation()
  const [isMaximized, setIsMaximized] = useState<boolean>(false)

  const planIsReady = planApproval.currentPlan?.status === 'ready'

  if (!isOpen) {
    return (
      <div className="h-8 px-3 border-t border-slate-800 bg-[#0b0f17] flex items-center justify-between text-xs shrink-0 select-none z-10">
        <div className="flex items-center gap-1.5 font-mono">
          <button
            type="button"
            onClick={() => {
              setActiveDockTab('terminal')
              onToggleOpen()
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-cyan-300 hover:bg-slate-900 transition-colors"
          >
            <Terminal className="w-3 h-3 text-cyan-400" />
            <span>Terminal</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveDockTab('git_diff')
              c.fetchGitStatusAndDiff()
              onToggleOpen()
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-indigo-300 hover:bg-slate-900 transition-colors"
          >
            <GitBranch className="w-3 h-3 text-indigo-400" />
            <span>Changes (Diff)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveDockTab('plan')
              onToggleOpen()
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-amber-300 hover:bg-slate-900 transition-colors relative"
          >
            <FileText className="w-3 h-3 text-amber-400" />
            <span>Plan</span>
            {planIsReady && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />}
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleOpen}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-cyan-300 transition-colors p-1"
          title="Espandi pannello strumenti"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  const effectiveHeight = isMaximized ? '80%' : `${height}px`

  return (
    <div
      style={{ height: effectiveHeight }}
      className={`border-t border-slate-800 bg-[#0b0f17] flex flex-col shrink-0 overflow-hidden select-text z-10 transition-[height] duration-75 ${
        isResizing ? 'select-none pointer-events-none' : ''
      }`}
    >
      {/* Resizable handle on top edge */}
      {!isMaximized && (
        <div
          role="separator"
          tabIndex={0}
          onMouseDown={onMouseDownResize}
          aria-label="Ridimensiona pannello strumenti"
          className="h-1.5 w-full cursor-row-resize hover:bg-cyan-500/60 bg-slate-800/60 transition-colors shrink-0"
        />
      )}

      {/* Dock Tab Bar */}
      <div className="h-9 px-3 border-b border-slate-800/80 bg-slate-950/80 flex items-center justify-between text-xs shrink-0 select-none">
        {/* Tab Buttons */}
        <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Strumenti dock inferiore">
          <button
            type="button"
            role="tab"
            id="dock-tab-terminal"
            aria-selected={activeDockTab === 'terminal'}
            aria-controls="dock-panel-terminal"
            tabIndex={activeDockTab === 'terminal' ? 0 : -1}
            onClick={() => setActiveDockTab('terminal')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] transition-colors focus-ring cursor-pointer ${
              activeDockTab === 'terminal'
                ? 'bg-slate-900 text-cyan-300 border border-cyan-800/60 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t('coding.terminalTab')}</span>
          </button>

          <button
            type="button"
            role="tab"
            id="dock-tab-git_diff"
            aria-selected={activeDockTab === 'git_diff'}
            aria-controls="dock-panel-git_diff"
            tabIndex={activeDockTab === 'git_diff' ? 0 : -1}
            onClick={() => {
              setActiveDockTab('git_diff')
              c.fetchGitStatusAndDiff()
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] transition-colors focus-ring cursor-pointer ${
              activeDockTab === 'git_diff'
                ? 'bg-slate-900 text-indigo-300 border border-indigo-800/60 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
            <span>Changes (Diff)</span>
          </button>

          <button
            type="button"
            role="tab"
            id="dock-tab-plan"
            aria-selected={activeDockTab === 'plan'}
            aria-controls="dock-panel-plan"
            tabIndex={activeDockTab === 'plan' ? 0 : -1}
            onClick={() => setActiveDockTab('plan')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] transition-colors focus-ring cursor-pointer relative ${
              activeDockTab === 'plan'
                ? 'bg-slate-900 text-amber-300 border border-amber-800/60 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            <span>Plan</span>
            {planIsReady && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping absolute top-1 right-1" />}
          </button>
        </div>

        {/* Right Dock Controls: Maximize, Minimize, Close */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsMaximized((prev) => !prev)}
            title={isMaximized ? 'Ripristina dimensione' : 'Massimizza'}
            aria-label={isMaximized ? 'Ripristina dimensione dock' : 'Massimizza dock'}
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors focus-ring cursor-pointer"
          >
            {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={onToggleOpen}
            title="Chiudi dock"
            aria-label="Chiudi dock strumenti"
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded transition-colors focus-ring cursor-pointer"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Dock Content Area */}
      <div className="flex-1 overflow-hidden relative bg-[#090d16]">
        {activeDockTab === 'terminal' && (
          <CodingTerminal
            terminalLogs={c.terminalLogs}
            terminalInput={c.terminalInput}
            setTerminalInput={c.setTerminalInput}
            onRunCommand={c.handleRunTerminalCommand}
            onClearTerminal={c.handleClearTerminal}
            isExecuting={c.isExecuting}
            autoScroll={autoScroll}
          />
        )}

        {activeDockTab === 'git_diff' && (
          <GitDiffPanel
            gitStatusLines={c.gitStatusLines}
            gitDiffText={c.gitDiffText}
            isFetchingGit={c.isFetchingGit}
            onRefreshGit={c.fetchGitStatusAndDiff}
          />
        )}

        {activeDockTab === 'plan' && (
          <PlanPanel
            plan={planApproval.currentPlan}
            planHistory={planApproval.planHistory}
            activePlanIndex={planApproval.activePlanIndex}
            onSelectPlanVersion={planApproval.selectPlanVersion}
            isGenerating={planApproval.isGeneratingPlan}
            isExecuting={c.isExecuting}
            countdownSeconds={planApproval.countdownSeconds}
            isAutoProceedPaused={planApproval.isAutoProceedPaused}
            autoProceedEnabled={settings?.autoProceedPlan !== false}
            interviewQuestions={planApproval.interviewQuestions}
            isInterviewActive={planApproval.isInterviewActive}
            isAnalyzingInterview={planApproval.isAnalyzingInterview}
            onConfirmInterview={planApproval.confirmInterviewAnswers}
            onSkipInterview={planApproval.skipInterviewWithRecommended}
            onApprove={planApproval.handleApprovePlan}
            onReject={planApproval.handleRejectPlan}
            onTogglePauseAutoProceed={() => planApproval.setIsAutoProceedPaused(!planApproval.isAutoProceedPaused)}
            onUpdatePlanText={planApproval.handleUpdatePlanText}
            completedStepCount={c.currentStep}
          />
        )}
      </div>
    </div>
  )
}
