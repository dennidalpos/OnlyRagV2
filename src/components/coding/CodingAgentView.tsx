import React, { useState, useRef, useMemo } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import {
  FileCode2,
  Paperclip,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Save,
  Terminal,
  GripVertical,
  ChevronRight,
  Copy,
  Check,
  Split,
  Plus,
  X,
  Code2,
  PanelLeft,
  Activity,
  FileText,
  ScanLine,
} from 'lucide-react'
import { AppSettings, WorkspaceFile, DiagnosticsData } from '../../types'
import { SystemPromptModal } from '../common/SystemPromptModal'
import { WorkspaceExplorer } from './WorkspaceExplorer'
import { AgentActionLogPanel } from './AgentActionLogPanel'
import { GitDiffPanel } from './GitDiffPanel'
import { CodingTerminal } from './CodingTerminal'
import { ActivitiesPanel } from './ActivitiesPanel'
import { SlmDiagnosticsPanel } from './SlmDiagnosticsPanel'
import { PlanPanel } from './PlanPanel'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { usePlanApproval, AgentPlan } from '../../hooks/usePlanApproval'
import { CodingHeader } from './CodingHeader'
import { PendingApprovalModal } from './PendingApprovalModal'
import { SkillHubModal } from './SkillHubModal'
import { evaluateTaskComplexity } from '../../services/complexityRouterService'
import { useTranslation } from '../../i18n'

export type AgentMode = 'plan' | 'ask' | 'agent'

interface CodingAgentViewProps {
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
  diagnostics?: DiagnosticsData | null
}

export const CodingAgentView: React.FC<CodingAgentViewProps> = ({ settings, onUpdateSettings, diagnostics }) => {
  const { t } = useTranslation()
  const c = useCodingAgent(settings)

  // Single autoscroll toggle shared by every agent-opened panel (action log, terminal, ...)
  // so disabling it stops auto-scrolling everywhere in the Coding Agent Studio, not just one panel.
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  // The prompt textarea is cleared the instant a task is submitted (see useCodingAgent's
  // handleAgentExecute), so re-evaluating complexity from the live draft while a task is
  // executing would show a meaningless "empty prompt" tier for the entire run. Freeze the
  // routed complexity on the prompt that was actually sent once execution starts, and only
  // go back to previewing the live draft once idle again.
  const [lastExecutedPrompt, setLastExecutedPrompt] = useState<string>('')

  // Plan Hook Integration with Session Isolation
  const planApproval = usePlanApproval({
    settings,
    activeSessionId: c.activeSessionId,
    workspacePath: c.workspacePath,
    onPlanApproved: (_approvedPlan) => {
      setLastExecutedPrompt(c.agentPrompt)
      c.handleAgentExecute()
    },
  })

  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(460)
  const [showWorkspaceSidebar, setShowWorkspaceSidebar] = useState<boolean>(false)
  const [isDiffMode, setIsDiffMode] = useState<boolean>(false)
  const [copiedPath, setCopiedPath] = useState<boolean>(false)
  const [isSkillHubOpen, setIsSkillHubOpen] = useState<boolean>(false)
  const [isResizing, setIsResizing] = useState<boolean>(false)

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

  // True when the most recent approved plan still has non-verified milestones
  // left over from an interrupted/finished run, i.e. residue a new plan should
  // consolidate (see handleGeneratePlanFromPrompt / C7 reconciliation context).
  const hasPendingUnconsolidatedMilestones = useMemo(() => {
    if (c.isExecuting) return false
    const plan = planApproval.currentPlan
    if (!plan || plan.status !== 'approved' || !plan.milestones) return false
    return plan.milestones.some((m) => m.status !== 'verified')
  }, [c.isExecuting, planApproval.currentPlan])

  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(460)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = leftPanelWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const deltaX = moveEvent.clientX - startXRef.current
      const newWidth = Math.min(850, Math.max(300, startWidthRef.current + deltaX))
      setLeftPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      setIsResizing(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const getLanguageFromExtension = (filename?: string) => {
    if (!filename) return 'typescript'
    if (filename.endsWith('.tsx') || filename.endsWith('.ts')) return 'typescript'
    if (filename.endsWith('.json')) return 'json'
    if (filename.endsWith('.py')) return 'python'
    if (filename.endsWith('.css')) return 'css'
    if (filename.endsWith('.html')) return 'html'
    if (filename.endsWith('.md')) return 'markdown'
    return 'plaintext'
  }

  const handleCopyPath = () => {
    if (c.selectedFile?.path) {
      navigator.clipboard.writeText(c.selectedFile.path)
      setCopiedPath(true)
      setTimeout(() => setCopiedPath(false), 2000)
    }
  }

  const getBreadcrumbParts = (filePath?: string) => {
    if (!filePath) return [t('common.noFileOpen')]
    const normalized = filePath.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    return parts.length > 5 ? ['...', ...parts.slice(-4)] : parts
  }

  // Sending a prompt always executes directly. Plan drafting is a separate,
  // explicit action (see the dedicated "Genera piano" composer icon in
  // CodingHeader), decoupled from every-send plan generation.
  const handleInitiateTaskExecution = () => {
    if (!c.agentPrompt.trim()) return
    setLastExecutedPrompt(c.agentPrompt)
    c.handleAgentExecute()
  }

  const handleGeneratePlanFromPrompt = async () => {
    if (!c.agentPrompt.trim()) return
    c.setActiveTab('plan')
    await planApproval.generatePlan(c.agentPrompt, undefined, c.currentStep)
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
          <WorkspaceExplorer
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
            onRenameSession={c.handleRenameSession}
            onClose={() => setShowWorkspaceSidebar(false)}
          />
        )}

        {/* Left Column: Interactive Timeline & Prompt Composer */}
        <div style={{ width: `${leftPanelWidth}px` }} className="flex flex-col border-r border-slate-800 bg-slate-950 shrink-0 overflow-hidden">
          {/* Sub-toolbar: Workspace trigger & conversation status */}
          <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs shrink-0">
            <button
              type="button"
              onClick={() => setShowWorkspaceSidebar(!showWorkspaceSidebar)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-colors focus-ring ${
                showWorkspaceSidebar
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80'
                  : 'bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <PanelLeft className="w-3.5 h-3.5" />
              <span>Workspace Explorer ({c.files.length})</span>
            </button>

            <span className="text-[11px] font-mono text-slate-400">
              {c.isExecuting && c.currentStep > 0
                ? `Step ${c.currentStep}/${c.maxSteps}`
                : t('coding.stepsCount', { count: c.actionLogs.length })}
            </span>
          </div>

          <div className="flex-1 overflow-hidden">
            <AgentActionLogPanel
              actionLogs={c.actionLogs}
              agentMode={c.agentMode}
              setAgentMode={c.setAgentMode}
              agentPrompt={c.agentPrompt}
              setAgentPrompt={c.setAgentPrompt}
              isExecuting={c.isExecuting}
              currentStep={c.currentStep}
              maxSteps={c.maxSteps}
              activeSkills={c.activeSkills}
              streamingText={c.streamingText}
              onExecute={handleInitiateTaskExecution}
              onGeneratePlan={handleGeneratePlanFromPrompt}
              hasPendingUnconsolidatedMilestones={hasPendingUnconsolidatedMilestones}
              onCancel={c.handleCancelAgent}
              pinnedFiles={c.pinnedFiles}
              ingestedDocs={c.ingestedDocs}
              attachedDocIds={c.attachedDocIds}
              onToggleAttachDoc={c.toggleAttachDoc}
              selectedFile={c.selectedFile}
              activeModelName={activeModelName}
              settings={settings}
              availableModels={diagnostics?.ollama.models}
              onOpenFile={c.handleOpenFile}
              promptQueue={c.promptQueue}
              onRemoveFromQueue={c.removeFromPromptQueue}
              onEditPromptInQueue={c.editPromptInQueue}
              onOpenPromptModal={() => c.setIsPromptModalOpen(true)}
              onOpenSkillHubModal={() => setIsSkillHubOpen(true)}
              onResetSession={() => {
                planApproval.resetPlanHistory()
                c.handleNewSession()
              }}
              onCompactContext={c.compactContext}
              workspacePath={c.workspacePath}
              workspaceSessions={c.workspaceSessions}
              activeSessionId={c.activeSessionId}
              activeSession={c.activeSession}
              onCreateSession={c.handleCreateSession}
              onSwitchSession={c.handleSwitchSession}
              onDeleteSession={c.handleDeleteSession}
              onRenameSession={c.handleRenameSession}
              onSelectWorkspaceFolder={c.handleSelectWorkspaceFolder}
              changeMetrics={c.changeMetrics}
              autoScroll={autoScroll}
              onToggleAutoScroll={() => setAutoScroll((prev) => !prev)}
            />
          </div>
        </div>

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
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              setLeftPanelWidth((prev) => Math.max(300, prev - 20))
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              setLeftPanelWidth((prev) => Math.min(850, prev + 20))
            }
          }}
          className={`w-1.5 hover:w-2 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-all shrink-0 flex items-center justify-center group focus-ring ${
            isResizing ? 'bg-cyan-500 w-2 ring-2 ring-cyan-500/50' : ''
          }`}
          title={t('coding.resizePanels')}
        >
          <GripVertical className={`w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isResizing ? 'opacity-100 text-slate-950' : ''}`} />
        </div>

        {/* Right Column: Multi-tab Monaco Code, Plan, Activities & Diff Editor */}
        <div className={`flex-1 flex flex-col overflow-hidden bg-slate-950 min-w-[350px] ${isResizing ? 'pointer-events-none select-none' : ''}`}>
          {/* Top Editor Tab Bar */}
          <div className="bg-slate-900/90 border-b border-slate-800 px-2 pt-1 flex items-center justify-between text-xs shrink-0 overflow-x-auto select-none">
            <div className="flex items-center gap-1 overflow-x-auto py-0.5">
              {/* File Tabs */}
              {c.openFiles.map((file: WorkspaceFile) => {
                const isActive = c.activeTab === 'editor' && c.selectedFile?.path === file.path
                const isDirty = isActive && !c.isSaved
                return (
                  <div
                    key={file.path}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={0}
                    onClick={() => c.handleOpenFile(file)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        c.handleOpenFile(file)
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg font-mono text-xs cursor-pointer transition-all border-x border-slate-800 focus-ring ${
                      isActive
                        ? 'bg-slate-950 border-t-2 border-t-cyan-400 text-slate-100 font-bold shadow-md'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850 border-t-2 border-transparent'
                    }`}
                  >
                    <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <span className="truncate max-w-[140px]">{file.name}</span>
                    {isDirty && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title={t('coding.dirtyBadge')} />}
                    <button
                      type="button"
                      onClick={(e) => c.handleCloseFile(file, e)}
                      className="p-0.5 hover:bg-slate-800 hover:text-slate-100 text-slate-400 rounded transition-colors focus-ring"
                      title={t('common.close')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}

              {c.openFiles.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-950 border-t-2 border-t-cyan-400 border-x border-slate-800 rounded-t-lg text-slate-400 font-mono text-xs">
                  <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{t('coding.noFilesOpen')}</span>
                </div>
              )}

              {/* Utility Tabs: Plan, Activities, Terminal & Git Diff */}
              <button
                type="button"
                onClick={() => c.setActiveTab('plan')}
                className={`px-3 py-1.5 rounded-t-lg font-medium transition-colors flex items-center gap-1.5 border-t-2 focus-ring relative ${
                  c.activeTab === 'plan'
                    ? 'bg-slate-950 text-cyan-300 border-t-cyan-400 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850 border-transparent'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-amber-400" /> Plan
                {planApproval.currentPlan?.status === 'ready' && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping absolute top-1 right-1" />
                )}
              </button>

              <button
                type="button"
                onClick={() => c.setActiveTab('activities')}
                className={`px-3 py-1.5 rounded-t-lg font-medium transition-colors flex items-center gap-1.5 border-t-2 focus-ring ${
                  c.activeTab === 'activities'
                    ? 'bg-slate-950 text-cyan-300 border-t-cyan-400 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850 border-transparent'
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-emerald-400" /> Attività
              </button>

              <button
                type="button"
                onClick={() => c.setActiveTab('slm_diagnostics')}
                className={`px-3 py-1.5 rounded-t-lg font-medium transition-colors flex items-center gap-1.5 border-t-2 focus-ring ${
                  c.activeTab === 'slm_diagnostics'
                    ? 'bg-slate-950 text-cyan-300 border-t-cyan-400 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850 border-transparent'
                }`}
              >
                <ScanLine className="w-3.5 h-3.5 text-fuchsia-400" /> {t('coding.slmDiagnosticsTab')}
              </button>

              <button
                type="button"
                onClick={() => c.setActiveTab('terminal')}
                className={`px-3 py-1.5 rounded-t-lg font-medium transition-colors flex items-center gap-1.5 border-t-2 focus-ring ${
                  c.activeTab === 'terminal'
                    ? 'bg-slate-950 text-cyan-300 border-t-cyan-400 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850 border-transparent'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" /> {t('coding.terminalTab')}
              </button>

              <button
                type="button"
                onClick={() => {
                  c.setActiveTab('git_diff')
                  c.fetchGitStatusAndDiff()
                }}
                className={`px-3 py-1.5 rounded-t-lg font-medium transition-colors flex items-center gap-1.5 border-t-2 focus-ring ${
                  c.activeTab === 'git_diff'
                    ? 'bg-slate-950 text-cyan-300 border-t-cyan-400 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850 border-transparent'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" /> {t('coding.gitDiffTab')}
              </button>
            </div>

            {/* Right Editor Controls: Save, Diff Split, Copy Path */}
            <div className="flex items-center gap-1.5 pb-1">
              {c.selectedFile && c.activeTab === 'editor' && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsDiffMode(!isDiffMode)}
                    aria-label={t('coding.diffToggleTitle')}
                    className={`p-1.5 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-1 ${
                      isDiffMode
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    title={isDiffMode ? t('coding.diffStandardTitle') : t('coding.diffToggleTitle')}
                  >
                    <Split className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={c.handleSaveFile}
                    disabled={c.isSaved}
                    aria-label={t('coding.saveButton')}
                    className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-cyan-950/40"
                  >
                    <Save className="w-3 h-3" /> {t('coding.saveButton')}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Breadcrumbs Navigation Bar */}
          {c.selectedFile && c.activeTab === 'editor' && (
            <div className="px-4 py-1.5 bg-[#0e131f] border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
              <div className="flex items-center gap-1 truncate">
                {getBreadcrumbParts(c.selectedFile.path).map((part, idx, arr) => (
                  <React.Fragment key={idx}>
                    <span className={idx === arr.length - 1 ? 'text-slate-200 font-semibold' : 'text-slate-400'}>
                      {part}
                    </span>
                    {idx < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-700 shrink-0" />}
                  </React.Fragment>
                ))}
              </div>

              <button
                type="button"
                onClick={handleCopyPath}
                aria-label={t('coding.copyPath')}
                className="p-1 text-slate-400 hover:text-slate-300 transition-colors"
                title={t('coding.copyPath')}
              >
                {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}

          {/* Editor / Terminal Content Area */}
          <div className="flex-1 relative overflow-hidden bg-[#0d121d]">
            {c.activeTab === 'editor' && (
              c.selectedFile ? (
                isDiffMode ? (
                  <DiffEditor
                    height="100%"
                    theme="vs-dark"
                    language={getLanguageFromExtension(c.selectedFile?.name)}
                    original={c.originalContent || ''}
                    modified={c.editorContent}
                    options={{
                      fontSize: 13,
                      automaticLayout: true,
                      fontFamily: 'Fira Code, Cascadia Code, monospace',
                      minimap: { enabled: false },
                      renderSideBySide: false,
                    }}
                  />
                ) : (
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    language={getLanguageFromExtension(c.selectedFile?.name)}
                    value={c.editorContent}
                    onChange={(val) => {
                      c.setEditorContent(val || '')
                      c.setIsSaved(false)
                    }}
                    options={{
                      fontSize: 13,
                      minimap: { enabled: true },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      fontFamily: 'Fira Code, Cascadia Code, monospace',
                      wordWrap: 'on',
                      lineNumbers: 'on',
                    }}
                  />
                )
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-400 font-sans">
                  <FileCode2 className="w-10 h-10 text-cyan-500/40" />
                  <div className="text-slate-300 font-semibold text-sm">{t('coding.noFilesOpen')}</div>
                  <p className="text-xs text-slate-400 max-w-sm">
                    {t('coding.emptyLogs')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowWorkspaceSidebar(true)}
                    className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl text-xs transition-colors"
                  >
                    {t('coding.filesTab')}
                  </button>
                </div>
              )
            )}

            {c.activeTab === 'plan' && (
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
                onApprove={planApproval.handleApprovePlan}
                onReject={planApproval.handleRejectPlan}
                onTogglePauseAutoProceed={() => planApproval.setIsAutoProceedPaused(!planApproval.isAutoProceedPaused)}
                onUpdatePlanText={planApproval.handleUpdatePlanText}
                completedStepCount={c.currentStep}
              />
            )}

            {c.activeTab === 'activities' && (
              <ActivitiesPanel
                actionLogs={c.actionLogs}
                isExecuting={c.isExecuting}
                activeSkills={c.activeSkills}
                agentPrompt={c.agentPrompt}
                activeModelName={activeModelName}
                openFilesCount={c.openFiles.length}
                pinnedFilesCount={c.pinnedFiles.size}
                attachedDocsCount={c.attachedDocIds.size}
              />
            )}

            {c.activeTab === 'slm_diagnostics' && <SlmDiagnosticsPanel />}

            {c.activeTab === 'terminal' && (
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

            {c.activeTab === 'git_diff' && (
              <GitDiffPanel
                gitStatusLines={c.gitStatusLines}
                gitDiffText={c.gitDiffText}
                isFetchingGit={c.isFetchingGit}
                onRefreshGit={c.fetchGitStatusAndDiff}
              />
            )}
          </div>
        </div>
      </div>

      {/* Pending Approval Modal (Ask Mode) */}
      <PendingApprovalModal
        pendingApproval={c.pendingApproval}
        onApprove={c.handleApproveAction}
        onReject={() => c.setPendingApproval(null)}
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
    </div>
  )
}
