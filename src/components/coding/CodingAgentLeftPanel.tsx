import React from 'react'
import { AppSettings, DiagnosticsData } from '../../types'
import { AgentActionLogPanel } from './AgentActionLogPanel'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { usePlanApproval } from '../../hooks/usePlanApproval'

interface CodingAgentLeftPanelProps {
  c: ReturnType<typeof useCodingAgent>
  planApproval: ReturnType<typeof usePlanApproval>
  leftPanelWidth: number
  showWorkspaceSidebar: boolean
  onToggleWorkspaceSidebar: () => void
  activeModelName: string
  settings?: AppSettings
  diagnostics?: DiagnosticsData | null
  hasPendingUnconsolidatedMilestones: boolean
  onExecute: () => void
  onGeneratePlan: () => void
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
  onGeneratePlan,
  onOpenSkillHubModal,
  onOpenDiagnosticsModal,
  onOpenPromptHistorySearch,
  autoScroll,
  onToggleAutoScroll,
  onSelectRightTab,
  onUpdateSettings,
}) => {
  return (
    <div style={{ width: `${leftPanelWidth}px` }} className="flex flex-col border-r border-slate-800 bg-slate-950 shrink-0 overflow-hidden">
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
          onGeneratePlan={onGeneratePlan}
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
          onToggleAutoScroll={onToggleAutoScroll}
          showWorkspaceSidebar={showWorkspaceSidebar}
          onToggleWorkspaceSidebar={onToggleWorkspaceSidebar}
          filesCount={c.files.length}
          onOpenRightTab={onSelectRightTab}
          plan={planApproval.currentPlan}
          isGeneratingPlan={planApproval.isGeneratingPlan}
          countdownSeconds={planApproval.countdownSeconds}
          isAutoProceedPaused={planApproval.isAutoProceedPaused}
          autoProceedEnabled={planApproval.autoProceed}
          interviewQuestions={planApproval.interviewQuestions}
          isInterviewActive={planApproval.isInterviewActive}
          isAnalyzingInterview={planApproval.isAnalyzingInterview}
          onConfirmInterview={planApproval.confirmInterviewAnswers}
          onSkipInterview={planApproval.skipInterviewWithRecommended}
          onApprovePlan={planApproval.handleApprovePlan}
          onRejectPlan={planApproval.handleRejectPlan}
          onTogglePauseAutoProceed={() => planApproval.setIsAutoProceedPaused((prev) => !prev)}
          onUpdateSettings={onUpdateSettings}
        />
      </div>
    </div>
  )
}
