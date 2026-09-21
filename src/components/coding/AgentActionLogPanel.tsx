import React from 'react'
import { AgentActionLog, IngestedDocument, WorkspaceFile, AppSettings, CodingSession, AgentChangeMetrics, AgentMode, AgentContextBudgetBreakdown } from '../../types'
import type { QueuedPrompt } from '../../hooks/useCodingAgent'
import { useAgentTimelineScroll } from '../../hooks/useAgentTimelineScroll'
import { AgentSessionHeaderBar } from './AgentSessionHeaderBar'
import { AgentTimeline } from './AgentTimeline'
import { PromptComposer } from './PromptComposer'

export { getStepModelName } from './agentLogMessageUtils'

interface AgentActionLogPanelProps {
  actionLogs: AgentActionLog[]
  agentMode: AgentMode
  setAgentMode: (mode: AgentMode) => void
  agentPrompt: string
  setAgentPrompt: (prompt: string) => void
  isExecuting: boolean
  currentStep?: number
  maxSteps?: number | string
  activeSkills?: string[]
  streamingText?: string
  currentStatusText?: string
  onExecute: () => void
  onCancel: () => void
  pinnedFiles: Map<string, WorkspaceFile>
  onTogglePinFile?: (file: WorkspaceFile) => void
  ingestedDocs: IngestedDocument[]
  attachedDocIds: Set<string>
  onToggleAttachDoc: (docId: string) => void
  selectedFile: WorkspaceFile | null
  activeModelName?: string
  settings?: AppSettings
  contextBudget?: AgentContextBudgetBreakdown | null
  availableModels?: string[]
  onOpenFile?: (file: WorkspaceFile) => void
  promptQueue?: QueuedPrompt[]
  onRemoveFromQueue?: (id: string) => void
  onEditPromptInQueue?: (id: string, newPrompt: string) => void
  onOpenPromptModal?: () => void
  onOpenSkillHubModal?: () => void
  onOpenDiagnosticsModal?: () => void
  onOpenPromptHistorySearch?: () => void
  onResetSession?: () => void
  onCompactContext?: () => void
  hasPendingUnconsolidatedMilestones?: boolean
  workspacePath?: string | null
  activeSession?: CodingSession | null
  onSelectWorkspaceFolder?: () => void
  changeMetrics?: AgentChangeMetrics
  autoScroll: boolean
  onToggleAutoScroll: () => void
  showWorkspaceSidebar?: boolean
  onToggleWorkspaceSidebar?: () => void
  filesCount?: number
  files?: WorkspaceFile[]
  onOpenRightTab?: (tab: 'editor' | 'terminal' | 'git_diff' | 'plan') => void
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
}

export const AgentActionLogPanel: React.FC<AgentActionLogPanelProps> = ({
  actionLogs,
  agentMode,
  setAgentMode,
  agentPrompt,
  setAgentPrompt,
  isExecuting,
  currentStep = 0,
  maxSteps = 50,
  streamingText = '',
  currentStatusText = '',
  onExecute,
  onCancel,
  pinnedFiles,
  onTogglePinFile,
  ingestedDocs,
  attachedDocIds,
  onToggleAttachDoc,
  activeModelName,
  settings,
  contextBudget,
  onOpenFile,
  promptQueue = [],
  onRemoveFromQueue,
  onEditPromptInQueue,
  onOpenPromptModal,
  onOpenSkillHubModal,
  onOpenDiagnosticsModal,
  onOpenPromptHistorySearch,
  onResetSession,
  onCompactContext,
  hasPendingUnconsolidatedMilestones = false,
  workspacePath,
  activeSession,
  onSelectWorkspaceFolder,
  changeMetrics,
  autoScroll,
  onToggleAutoScroll,
  showWorkspaceSidebar,
  onToggleWorkspaceSidebar,
  filesCount,
  files = [],
  onOpenRightTab,
  onUpdateSettings,
}) => {
  const autoInstallHubSkills = settings?.autoInstallHubSkills || 'disabled'
  const handleToggleAutoInstallSkills = onUpdateSettings
    ? () => {
        const nextVal = autoInstallHubSkills === 'prompt' ? 'disabled' : 'prompt'
        onUpdateSettings({
          autoInstallHubSkills: nextVal,
          enableSkillRouter: nextVal === 'prompt',
        })
      }
    : undefined

  const { bottomRef, scrollContainerRef, isScrolledUp, handleScroll, scrollToBottom, handleToggleAutoScroll } = useAgentTimelineScroll(
    actionLogs,
    streamingText,
    isExecuting,
    autoScroll,
    onToggleAutoScroll,
  )

  const maxContextLimit = contextBudget?.promptBudgetTokens || 0
  const estimatedTurnTokens = contextBudget?.promptTokens || 0
  const contextPercent = contextBudget?.utilizationPercent || 0
  const isContextHeavy = contextPercent >= 70

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-200 overflow-hidden select-text relative">
      <AgentSessionHeaderBar
        workspacePath={workspacePath}
        onSelectWorkspaceFolder={onSelectWorkspaceFolder}
        showWorkspaceSidebar={showWorkspaceSidebar}
        onToggleWorkspaceSidebar={onToggleWorkspaceSidebar}
        filesCount={filesCount}
        isExecuting={isExecuting}
        currentStep={currentStep}
        maxSteps={maxSteps}
        currentStatusText={currentStatusText}
        onCancel={onCancel}
      />

      <AgentTimeline
        actionLogs={actionLogs}
        activeSession={activeSession}
        setAgentPrompt={setAgentPrompt}
        activeModelName={activeModelName}
        workspacePath={workspacePath}
        files={files}
        onSelectWorkspaceFolder={onSelectWorkspaceFolder}
        onOpenFile={onOpenFile}
        onOpenRightTab={onOpenRightTab}
        isExecuting={isExecuting}
        currentStep={currentStep}
        maxSteps={maxSteps}
        streamingText={streamingText}
        currentStatusText={currentStatusText}
        scrollContainerRef={scrollContainerRef}
        bottomRef={bottomRef}
        isScrolledUp={isScrolledUp}
        onScroll={handleScroll}
        onScrollToBottom={() => scrollToBottom(true)}
      />

      <PromptComposer
        agentPrompt={agentPrompt}
        setAgentPrompt={setAgentPrompt}
        onExecute={onExecute}
        isExecuting={isExecuting}
        queueLength={promptQueue.length}
        agentMode={agentMode}
        setAgentMode={setAgentMode}
        autoScroll={autoScroll}
        onToggleAutoScroll={handleToggleAutoScroll}
        onResetSession={onResetSession}
        hasPendingUnconsolidatedMilestones={hasPendingUnconsolidatedMilestones}
        ingestedDocs={ingestedDocs}
        attachedDocIds={attachedDocIds}
        onToggleAttachDoc={onToggleAttachDoc}
        pinnedFiles={pinnedFiles}
        onTogglePinFile={onTogglePinFile}
        onOpenSkillHubModal={onOpenSkillHubModal}
        onOpenPromptModal={onOpenPromptModal}
        onOpenDiagnosticsModal={onOpenDiagnosticsModal}
        onOpenPromptHistorySearch={onOpenPromptHistorySearch}
        promptQueue={promptQueue}
        onRemoveFromQueue={onRemoveFromQueue}
        onEditPromptInQueue={onEditPromptInQueue}
        changeMetrics={changeMetrics}
        contextPercent={contextPercent}
        estimatedTurnTokens={estimatedTurnTokens}
        maxContextLimit={maxContextLimit}
        isContextHeavy={isContextHeavy}
        onCompactContext={onCompactContext}
        contextBudget={contextBudget}
        autoInstallHubSkills={autoInstallHubSkills}
        onToggleAutoInstallSkills={handleToggleAutoInstallSkills}
      />
    </div>
  )
}
