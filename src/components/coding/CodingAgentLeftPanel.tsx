import React from 'react'
import { AppSettings, DiagnosticsData } from '../../types'
import { AgentActionLogPanel } from './AgentActionLogPanel'
import type { CodingAgentState } from '../../hooks/useCodingAgent'
import type { usePlanApproval } from '../../hooks/usePlanApproval'

/** The Coding Agent fields the timeline and composer read. */
export type CodingAgentLeftPanelModel = Pick<
  CodingAgentState,
  | 'actionLogs'
  | 'agentMode'
  | 'setAgentMode'
  | 'agentPrompt'
  | 'setAgentPrompt'
  | 'isExecuting'
  | 'currentStep'
  | 'maxSteps'
  | 'activeSkills'
  | 'streamingText'
  | 'currentStatusText'
  | 'handleCancelAgent'
  | 'pinnedFiles'
  | 'handleTogglePinFile'
  | 'ingestedDocs'
  | 'attachedDocIds'
  | 'toggleAttachDoc'
  | 'selectedFile'
  | 'contextBudget'
  | 'handleOpenFile'
  | 'promptQueue'
  | 'removeFromPromptQueue'
  | 'editPromptInQueue'
  | 'setIsPromptModalOpen'
  | 'handleNewSession'
  | 'compactContext'
  | 'workspacePath'
  | 'activeSession'
  | 'handleSelectWorkspaceFolder'
  | 'changeMetrics'
  | 'files'
>

interface CodingAgentLeftPanelProps {
  c: CodingAgentLeftPanelModel
  planApproval: ReturnType<typeof usePlanApproval>
  leftPanelWidth: number
  showWorkspaceSidebar: boolean
  onToggleWorkspaceSidebar: () => void
  activeModelName: string
  settings?: AppSettings
  diagnostics?: DiagnosticsData | null
  hasPendingUnconsolidatedMilestones: boolean
  onExecute: () => void
  onOpenSkillHubModal: () => void
  onOpenDiagnosticsModal?: () => void
  onOpenPromptHistorySearch?: () => void
  autoScroll: boolean
  onToggleAutoScroll: () => void
  onSelectRightTab?: (tab: 'editor' | 'terminal' | 'git_diff' | 'plan') => void
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
}

export const CodingAgentLeftPanel: React.FC<CodingAgentLeftPanelProps> = ({
  c,
  planApproval,
  leftPanelWidth,
  showWorkspaceSidebar,
  onToggleWorkspaceSidebar,
  activeModelName,
  settings,
  diagnostics,
  hasPendingUnconsolidatedMilestones,
  onExecute,
  onOpenSkillHubModal,
  onOpenDiagnosticsModal,
  onOpenPromptHistorySearch,
  autoScroll,
  onToggleAutoScroll,
  onSelectRightTab,
  onUpdateSettings,
}) => {
  return (
    <div
      style={{ width: `min(${leftPanelWidth}px, calc(100% - 354px))` }}
      className="flex flex-col border-r border-slate-800 bg-slate-950 shrink-0 overflow-hidden"
    >
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
          currentStatusText={c.currentStatusText}
          onExecute={onExecute}
          hasPendingUnconsolidatedMilestones={hasPendingUnconsolidatedMilestones}
          onCancel={c.handleCancelAgent}
          pinnedFiles={c.pinnedFiles}
          onTogglePinFile={c.handleTogglePinFile}
          ingestedDocs={c.ingestedDocs}
          attachedDocIds={c.attachedDocIds}
          onToggleAttachDoc={c.toggleAttachDoc}
          selectedFile={c.selectedFile}
          activeModelName={activeModelName}
          settings={settings}
          contextBudget={c.contextBudget}
          availableModels={diagnostics?.ollama.models}
          onOpenFile={c.handleOpenFile}
          promptQueue={c.promptQueue}
          onRemoveFromQueue={c.removeFromPromptQueue}
          onEditPromptInQueue={c.editPromptInQueue}
          onOpenPromptModal={() => c.setIsPromptModalOpen(true)}
          onOpenSkillHubModal={onOpenSkillHubModal}
          onOpenDiagnosticsModal={onOpenDiagnosticsModal}
          onOpenPromptHistorySearch={onOpenPromptHistorySearch}
          onResetSession={() => {
            planApproval.resetPlanHistory()
            c.handleNewSession()
          }}
          onCompactContext={c.compactContext}
          workspacePath={c.workspacePath}
          activeSession={c.activeSession}
          onSelectWorkspaceFolder={c.handleSelectWorkspaceFolder}
          changeMetrics={c.changeMetrics}
          autoScroll={autoScroll}
          onToggleAutoScroll={onToggleAutoScroll}
          showWorkspaceSidebar={showWorkspaceSidebar}
          onToggleWorkspaceSidebar={onToggleWorkspaceSidebar}
          filesCount={c.files.length}
          files={c.files}
          onOpenRightTab={onSelectRightTab}
          onUpdateSettings={onUpdateSettings}
        />
      </div>
    </div>
  )
}
