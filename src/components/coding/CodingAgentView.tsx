import React, { useState, useMemo } from 'react'
import { GripVertical } from 'lucide-react'
import { AppSettings, DiagnosticsData } from '../../types'
import { SystemPromptModal } from '../common/SystemPromptModal'
import { WorkspaceExplorer } from './WorkspaceExplorer'
import { CodingAgentLeftPanel } from './CodingAgentLeftPanel'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { usePlanApproval } from '../../hooks/usePlanApproval'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { CodingHeader } from './CodingHeader'
import { PendingApprovalModal } from './PendingApprovalModal'
import { SkillHubModal } from './SkillHubModal'
import { SkillInstallApprovalModal } from './skills/SkillInstallApprovalModal'
import { PromptHistorySearchModal } from './PromptHistorySearchModal'
import { useSkillInstallApproval } from '../../hooks/useSkillInstallApproval'
import { useTranslation } from '../../i18n'
import { CodingEditorTabBar, CodingRightTab } from './CodingEditorTabBar'
import { CodingEditorContent } from './CodingEditorContent'
import { CodingTerminal } from './CodingTerminal'
import { GitDiffPanel } from './GitDiffPanel'
import { PlanPanel } from './PlanPanel'
import { SlmDiagnosticsPanel } from './SlmDiagnosticsPanel'
import { SystemDiagnosticsModal } from './SystemDiagnosticsModal'

export type AgentMode = 'plan' | 'ask' | 'agent'

interface CodingAgentViewProps {
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
  diagnostics?: DiagnosticsData | null
}

export const CodingAgentView: React.FC<CodingAgentViewProps> = ({ settings, onUpdateSettings, diagnostics }) => {
  const { t } = useTranslation()
  const c = useCodingAgent(settings)

  // Single autoscroll toggle shared by every agent-opened panel
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  // Unified Right Workspace View
  const [activeRightTab, setActiveRightTab] = useState<CodingRightTab>('editor')

  // Plan Hook Integration with Session Isolation
  const planApproval = usePlanApproval({
    settings,
    activeSessionId: c.activeSessionId,
    workspacePath: c.workspacePath,
    sessionPlans: c.activeSessionPlans,
    onSessionPlansChange: c.updateActiveSessionPlans,
    onPlanApproved: (_approvedPlan) => {
      c.setAgentMode('agent')
      c.handleAgentExecute(undefined, 'agent')
    },
  })

  const defaultInitialWidth = typeof window !== 'undefined'
    ? Math.max(560, Math.min(Math.round(window.innerWidth * 0.38), 750))
    : 560
  const { width: leftPanelWidth, isResizing, handleMouseDown, handleKeyDown } = useResizablePanel(
    defaultInitialWidth,
    320,
    950,
    'onlyrag_coding_left_panel_width'
  )
  const {
    width: explorerWidth,
    isResizing: isExplorerResizing,
    handleMouseDown: handleExplorerMouseDown,
    handleKeyDown: handleExplorerKeyDown,
  } = useResizablePanel(288, 200, 480, 'onlyrag_coding_workspace_explorer_width')
  const [showWorkspaceSidebar, setShowWorkspaceSidebar] = useState<boolean>(false)
  const [isDiffMode, setIsDiffMode] = useState<boolean>(false)
  const [copiedPath, setCopiedPath] = useState<boolean>(false)
  const [isSkillHubOpen, setIsSkillHubOpen] = useState<boolean>(false)
  const [isPromptHistorySearchOpen, setIsPromptHistorySearchOpen] = useState<boolean>(false)
  const [isDiagnosticsModalOpen, setIsDiagnosticsModalOpen] = useState<boolean>(false)
  const {
    activeRequest: activeSkillInstallRequest,
    approveInstall: approveSkillInstall,
    rejectInstall: rejectSkillInstall,
  } = useSkillInstallApproval(settings)

  const activeModelName = (c.isExecuting && c.currentLiveModel)
    ? c.currentLiveModel
    : settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b'

  const hasPendingUnconsolidatedMilestones = useMemo(() => {
    if (c.isExecuting) return false
    const plan = planApproval.currentPlan
    if (!plan || plan.status !== 'approved' || !plan.milestones) return false
    return plan.milestones.some((m) => m.status !== 'verified')
  }, [c.isExecuting, planApproval.currentPlan])

  const handleCopyPath = () => {
    if (c.selectedFile?.path) {
      navigator.clipboard.writeText(c.selectedFile.path)
      setCopiedPath(true)
      setTimeout(() => setCopiedPath(false), 2000)
    }
  }

  const handleGeneratePlanFromPrompt = async () => {
    if (!c.agentPrompt.trim()) return
    setActiveRightTab('plan')
    await planApproval.startPlanFlow(c.agentPrompt, undefined, c.currentStep)
  }

  const handleInitiateTaskExecution = () => {
    if (!c.agentPrompt.trim()) return
    if (c.agentMode === 'plan') {
      handleGeneratePlanFromPrompt()
    } else {
      c.handleAgentExecute()
    }
  }

  const handleSelectTab = (tab: CodingRightTab) => {
    setActiveRightTab(tab)
    if (tab === 'git_diff') {
      c.fetchGitStatusAndDiff()
    }
  }

  const handleOpenFileTab = (file: typeof c.openFiles[0]) => {
    c.handleOpenFile(file)
    setActiveRightTab('editor')
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b0f17] overflow-hidden select-text">
      {/* Antigravity Top Header Bar */}
      <CodingHeader
        guestOsInfo={c.guestOsInfo}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        activeSkills={c.activeSkills}
        installedModels={diagnostics?.ollama?.models || []}
        activeModel={activeModelName}
        onOpenDiagnosticsModal={() => setIsDiagnosticsModalOpen(true)}
        onOpenSkillHubModal={() => setIsSkillHubOpen(true)}
        onOpenPromptModal={() => c.setIsPromptModalOpen(true)}
      />

      {/* Main Workspace Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Full Workspace Explorer Sidebar */}
        {showWorkspaceSidebar && (
          <>
            <WorkspaceExplorer
              width={explorerWidth}
              projects={c.projects}
              activeProjectPath={c.workspacePath}
              onAddProject={c.handleAddProject}
              onRemoveProject={c.handleRemoveProject}
              onSelectProject={c.handleSelectProject}
              files={c.files}
              selectedFilePath={c.selectedFile?.path || null}
              pinnedPaths={new Set(c.pinnedFiles.keys())}
              onOpenFile={handleOpenFileTab}
              onTogglePinFile={c.handleTogglePinFile}
              onRefreshFiles={() => c.workspacePath && c.loadWorkspaceFiles(c.workspacePath)}
              workspaceSessions={c.workspaceSessions}
              activeSessionId={c.activeSessionId}
              onCreateSession={c.handleCreateSession}
              onSwitchSession={c.handleSwitchSession}
              onDeleteSession={c.handleDeleteSession}
              onClearSessions={c.handleClearSessionHistory}
              onRenameSession={c.handleRenameSession}
              onOpenPromptHistorySearch={() => setIsPromptHistorySearchOpen(true)}
              onClose={() => setShowWorkspaceSidebar(false)}
            />
            {/* Resizable Explorer Divider Handle */}
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-valuenow={explorerWidth}
              aria-valuemin={200}
              aria-valuemax={480}
              aria-label={t('coding.resizePanels')}
              onMouseDown={handleExplorerMouseDown}
              onKeyDown={handleExplorerKeyDown}
              className={`w-1 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-colors duration-150 shrink-0 flex items-center justify-center group focus-ring z-20 ${
                isExplorerResizing ? 'bg-cyan-500 ring-2 ring-cyan-500/50' : ''
              }`}
              title={t('coding.resizePanels')}
            >
              <GripVertical className={`w-2.5 h-2.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isExplorerResizing ? 'opacity-100 text-slate-950' : ''}`} />
            </div>
          </>
        )}

        {/* Left Column: Interactive Timeline & Prompt Composer */}
        <CodingAgentLeftPanel
          c={c}
          planApproval={planApproval}
          leftPanelWidth={leftPanelWidth}
          showWorkspaceSidebar={showWorkspaceSidebar}
          onToggleWorkspaceSidebar={() => setShowWorkspaceSidebar(!showWorkspaceSidebar)}
          activeModelName={activeModelName}
          settings={settings}
          diagnostics={diagnostics}
          hasPendingUnconsolidatedMilestones={hasPendingUnconsolidatedMilestones}
          onExecute={handleInitiateTaskExecution}
          onGeneratePlan={handleGeneratePlanFromPrompt}
          onOpenSkillHubModal={() => setIsSkillHubOpen(true)}
          onOpenDiagnosticsModal={() => setIsDiagnosticsModalOpen(true)}
          onOpenPromptHistorySearch={() => setIsPromptHistorySearchOpen(true)}
          autoScroll={autoScroll}
          onToggleAutoScroll={() => setAutoScroll((prev) => !prev)}
          onSelectRightTab={handleSelectTab}
          onUpdateSettings={onUpdateSettings}
        />

        {/* Resizable Divider Handle */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuenow={leftPanelWidth}
          aria-valuemin={300}
          aria-valuemax={850}
          aria-label={t('coding.resizePanels')}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          className={`w-1 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-colors duration-150 shrink-0 flex items-center justify-center group focus-ring ${
            isResizing ? 'bg-cyan-500 ring-2 ring-cyan-500/50' : ''
          }`}
          title={t('coding.resizePanels')}
        >
          <GripVertical className={`w-2.5 h-2.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isResizing ? 'opacity-100 text-slate-950' : ''}`} />
        </div>

        {/* Right Column: Unified Full-Height Workspace Area */}
        <div className={`flex-1 flex flex-col overflow-hidden bg-[#090d16] min-w-[350px] ${isResizing ? 'pointer-events-none select-none' : ''}`}>
          <CodingEditorTabBar
            openFiles={c.openFiles}
            selectedFile={c.selectedFile}
            isSaved={c.isSaved}
            onOpenFile={handleOpenFileTab}
            onCloseFile={c.handleCloseFile}
            isDiffMode={isDiffMode}
            setIsDiffMode={setIsDiffMode}
            onSaveFile={c.handleSaveFile}
            activeTab={activeRightTab}
            onSelectTab={handleSelectTab}
            changedFilesCount={c.changeMetrics?.filesTouched || 0}
            planIsReady={planApproval.currentPlan?.status === 'ready'}
            planIsInProgress={planApproval.isGeneratingPlan}
          />

          {/* Active View Container */}
          <div className="flex-1 overflow-hidden relative">
            {activeRightTab === 'editor' && (
              <CodingEditorContent
                c={c}
                settings={settings}
                isDiffMode={isDiffMode}
                copiedPath={copiedPath}
                onCopyPath={handleCopyPath}
                onShowWorkspaceSidebar={() => setShowWorkspaceSidebar(true)}
              />
            )}

            {activeRightTab === 'terminal' && (
              <CodingTerminal
                terminalLogs={c.terminalLogs}
                terminalInput={c.terminalInput}
                setTerminalInput={c.setTerminalInput}
                onRunCommand={c.handleRunTerminalCommand}
                onClearTerminal={c.handleClearTerminal}
                isExecuting={c.isExecuting}
                autoScroll={autoScroll}
                navigateHistory={c.navigateHistory}
                workspacePath={c.workspacePath}
              />
            )}

            {activeRightTab === 'git_diff' && (
              <GitDiffPanel
                gitStatusLines={c.gitStatusLines}
                gitDiffText={c.gitDiffText}
                isFetchingGit={c.isFetchingGit}
                onRefreshGit={c.fetchGitStatusAndDiff}
              />
            )}

            {activeRightTab === 'plan' && (
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

            {activeRightTab === 'slm_diagnostics' && (
              <SlmDiagnosticsPanel />
            )}
          </div>
        </div>
      </div>

      {/* Pending Approval Modal (Ask Mode) */}
      <PendingApprovalModal
        pendingApproval={c.pendingApproval}
        onApprove={c.handleApproveAction}
        onReject={c.handleRejectAction}
      />

      {/* System Prompt Customization Modal */}
      {settings && onUpdateSettings && (
        <SystemPromptModal
          isOpen={c.isPromptModalOpen}
          onClose={() => c.setIsPromptModalOpen(false)}
          module="coding"
          moduleTitle={t('coding.title')}
          activeModelName={settings.codingModel || settings.defaultModel || 'qwen2.5-coder:7b'}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}

      {/* Skill Hub & Marketplace Modal */}
      <SkillHubModal
        isOpen={isSkillHubOpen}
        onClose={() => setIsSkillHubOpen(false)}
        workspacePath={c.workspacePath}
      />

      {/* Hub Skill Auto-Install Confirmation (autoInstallHubSkills: 'prompt') */}
      <SkillInstallApprovalModal
        request={activeSkillInstallRequest}
        onApprove={approveSkillInstall}
        onReject={rejectSkillInstall}
      />

      {/* Cross-Project Prompt History Search */}
      <PromptHistorySearchModal
        isOpen={isPromptHistorySearchOpen}
        onClose={() => setIsPromptHistorySearchOpen(false)}
        projects={c.projects}
        onJump={c.jumpToProjectAndSession}
      />

      {/* System Diagnostics & Telemetry Modal */}
      <SystemDiagnosticsModal
        isOpen={isDiagnosticsModalOpen}
        onClose={() => setIsDiagnosticsModalOpen(false)}
        guestOsInfo={c.guestOsInfo}
        settings={settings}
        actionLogs={c.actionLogs}
        isExecuting={c.isExecuting}
        activeModelName={activeModelName}
        openFilesCount={c.openFiles.length}
        pinnedFilesCount={c.pinnedFiles.size}
        attachedDocsCount={c.attachedDocIds.size}
        sessionId={c.activeSessionId}
        workspacePath={c.workspacePath}
        activeSkills={c.activeSkills}
      />
    </div>
  )
}
