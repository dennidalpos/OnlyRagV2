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
import { evaluateTaskComplexity } from '../../services/complexityRouterService'
import { useTranslation } from '../../i18n'
import { CodingEditorTabBar } from './CodingEditorTabBar'
import { CodingEditorContent } from './CodingEditorContent'
import { CodingBottomDock, BottomDockTab } from './CodingBottomDock'

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
  const [lastExecutedPrompt, setLastExecutedPrompt] = useState<string>('')

  // Bottom dock state (Layout Opzione 1: Monaco Top + Dock Bottom)
  const [isBottomDockOpen, setIsBottomDockOpen] = useState<boolean>(false)
  const [activeDockTab, setActiveDockTab] = useState<BottomDockTab>('terminal')
  const [dockHeight, setDockHeight] = useState<number>(220)
  const [isDockResizing, setIsDockResizing] = useState<boolean>(false)

  // Plan Hook Integration with Session Isolation
  const planApproval = usePlanApproval({
    settings,
    activeSessionId: c.activeSessionId,
    workspacePath: c.workspacePath,
    sessionPlans: c.activeSessionPlans,
    onSessionPlansChange: c.updateActiveSessionPlans,
    onPlanApproved: (_approvedPlan) => {
      setLastExecutedPrompt(c.agentPrompt)
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
  const {
    activeRequest: activeSkillInstallRequest,
    approveInstall: approveSkillInstall,
    rejectInstall: rejectSkillInstall,
  } = useSkillInstallApproval()

  const routedComplexity = useMemo(() => {
    const promptForRouting = c.isExecuting ? lastExecutedPrompt : c.agentPrompt
    return evaluateTaskComplexity(promptForRouting, {
      attachedFilesCount: c.pinnedFiles.size,
      contextSizeChars: c.editorContent.length,
      settings,
      availableModels: diagnostics?.ollama?.models,
    })
  }, [settings, c.isExecuting, lastExecutedPrompt, c.agentPrompt, c.pinnedFiles.size, c.editorContent.length, diagnostics?.ollama?.models])

  const activeModelName = settings?.useComplexityRouting
    ? routedComplexity.modelName
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

  const handleInitiateTaskExecution = () => {
    if (!c.agentPrompt.trim()) return
    setLastExecutedPrompt(c.agentPrompt)
    c.handleAgentExecute()
  }

  const handleGeneratePlanFromPrompt = async () => {
    if (!c.agentPrompt.trim()) return
    setActiveDockTab('plan')
    setIsBottomDockOpen(true)
    await planApproval.startPlanFlow(c.agentPrompt, undefined, c.currentStep)
  }

  const handleDockMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDockResizing(true)
    const startY = e.clientY
    const startHeight = dockHeight

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY
      const newHeight = Math.max(120, Math.min(500, startHeight + deltaY))
      setDockHeight(newHeight)
    }

    const onMouseUp = () => {
      setIsDockResizing(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleOpenDockTab = (tab: BottomDockTab) => {
    setActiveDockTab(tab)
    setIsBottomDockOpen(true)
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b0f17] overflow-hidden select-text">
      {/* Antigravity Top Header Bar */}
      <CodingHeader
        guestOsInfo={c.guestOsInfo}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        activeSkills={c.activeSkills}
        complexity={routedComplexity}
        activeModel={activeModelName}
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
              onOpenFile={c.handleOpenFile}
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
              className={`w-1.5 hover:w-2 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-all shrink-0 flex items-center justify-center group focus-ring z-20 ${
                isExplorerResizing ? 'bg-cyan-500 w-2 ring-2 ring-cyan-500/50' : ''
              }`}
              title={t('coding.resizePanels')}
            >
              <GripVertical className={`w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isExplorerResizing ? 'opacity-100 text-slate-950' : ''}`} />
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
          autoScroll={autoScroll}
          onToggleAutoScroll={() => setAutoScroll((prev) => !prev)}
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
          className={`w-1.5 hover:w-2 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-all shrink-0 flex items-center justify-center group focus-ring ${
            isResizing ? 'bg-cyan-500 w-2 ring-2 ring-cyan-500/50' : ''
          }`}
          title={t('coding.resizePanels')}
        >
          <GripVertical className={`w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isResizing ? 'opacity-100 text-slate-950' : ''}`} />
        </div>

        {/* Right Column: Pure Monaco Code Editor + Bottom Tool Dock (Layout Opzione 1) */}
        <div className={`flex-1 flex flex-col overflow-hidden bg-slate-950 min-w-[350px] ${isResizing ? 'pointer-events-none select-none' : ''}`}>
          <CodingEditorTabBar
            openFiles={c.openFiles}
            selectedFile={c.selectedFile}
            isSaved={c.isSaved}
            onOpenFile={c.handleOpenFile}
            onCloseFile={c.handleCloseFile}
            isDiffMode={isDiffMode}
            setIsDiffMode={setIsDiffMode}
            onSaveFile={c.handleSaveFile}
            isBottomDockOpen={isBottomDockOpen}
            onToggleBottomDock={() => setIsBottomDockOpen((prev) => !prev)}
            activeDockTab={activeDockTab}
            onOpenDockTab={handleOpenDockTab}
            planIsReady={planApproval.currentPlan?.status === 'ready'}
          />

          <CodingEditorContent
            c={c}
            settings={settings}
            isDiffMode={isDiffMode}
            copiedPath={copiedPath}
            onCopyPath={handleCopyPath}
            onShowWorkspaceSidebar={() => setShowWorkspaceSidebar(true)}
          />

          {/* Collapsible & Resizable Bottom Tool Dock */}
          <CodingBottomDock
            isOpen={isBottomDockOpen}
            onToggleOpen={() => setIsBottomDockOpen((prev) => !prev)}
            activeDockTab={activeDockTab}
            setActiveDockTab={setActiveDockTab}
            c={c}
            planApproval={planApproval}
            settings={settings}
            activeModelName={activeModelName}
            autoScroll={autoScroll}
            height={dockHeight}
            isResizing={isDockResizing}
            onMouseDownResize={handleDockMouseDown}
          />
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
    </div>
  )
}
