import React from 'react'
import { AgentActionLog, IngestedDocument, WorkspaceFile, AppSettings, CodingSession, AgentChangeMetrics, InterviewQuestion, UserInterviewAnswer, AgentMode } from '../../types'
import type { AgentPlan } from '../../hooks/usePlanApproval'
import type { QueuedPrompt } from '../../hooks/useCodingAgent'
import { useAgentTimelineScroll } from '../../hooks/useAgentTimelineScroll'
import { estimateTokenCount } from '../../lib/tokenEstimate'
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
  onGeneratePlan?: () => void
  hasPendingUnconsolidatedMilestones?: boolean
  workspacePath?: string | null
  workspaceSessions?: CodingSession[]
  activeSessionId?: string
  activeSession?: CodingSession | null
  onCreateSession?: () => void
  onSwitchSession?: (id: string) => void
  onDeleteSession?: (id: string) => void
  onRenameSession?: (id: string, title: string) => void
  onSelectWorkspaceFolder?: () => void
  changeMetrics?: AgentChangeMetrics
  autoScroll: boolean
  onToggleAutoScroll: () => void
  showWorkspaceSidebar?: boolean
  onToggleWorkspaceSidebar?: () => void
  filesCount?: number
  onOpenRightTab?: (tab: 'editor' | 'terminal' | 'git_diff' | 'plan') => void
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
  onGeneratePlan,
  hasPendingUnconsolidatedMilestones = false,
  workspacePath,
  workspaceSessions = [],
  activeSessionId,
  activeSession,
  onCreateSession,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
  onSelectWorkspaceFolder,
  changeMetrics,
  autoScroll,
  onToggleAutoScroll,
  showWorkspaceSidebar,
  onToggleWorkspaceSidebar,
  filesCount,
  onOpenRightTab,
  plan,
  isGeneratingPlan,
  countdownSeconds,
  isAutoProceedPaused,
  autoProceedEnabled,
  interviewQuestions,
  isInterviewActive,
  isAnalyzingInterview,
  onConfirmInterview,
  onSkipInterview,
  onApprovePlan,
  onRejectPlan,
  onTogglePauseAutoProceed,
  onUpdateSettings,
}) => {
  const autoInstallHubSkills = settings?.autoInstallHubSkills || 'auto'
  const handleToggleAutoInstallSkills = onUpdateSettings
    ? () => {
        const nextVal = autoInstallHubSkills === 'auto' ? 'disabled' : 'auto'
        onUpdateSettings({
          autoInstallHubSkills: nextVal,
          enableSkillRouter: nextVal === 'auto',
        })
      }
    : undefined

  const { bottomRef, scrollContainerRef, isScrolledUp, handleScroll, scrollToBottom, handleToggleAutoScroll } =
    useAgentTimelineScroll(actionLogs, streamingText, isExecuting, autoScroll, onToggleAutoScroll)

  // Context window tracking
  const maxContextLimit = settings?.hardwareProfile === 'High' ? 12000 : settings?.hardwareProfile === 'Low' ? 4000 : 7000
  const BASE_PROMPT_OVERHEAD_TOKENS = 650
  const recentLogsTokens = React.useMemo(() => {
    const recentLogs = actionLogs.slice(-8)
    return recentLogs.reduce((acc, log) => acc + estimateTokenCount(log.message) + estimateTokenCount((log.detail || '').slice(0, 1200)), 0)
  }, [actionLogs])
  const promptTokens = React.useMemo(() => estimateTokenCount(agentPrompt), [agentPrompt])
  const estimatedTurnTokens = Math.min(maxContextLimit, BASE_PROMPT_OVERHEAD_TOKENS + promptTokens + recentLogsTokens)
  const contextPercent = Math.min(100, Math.round((estimatedTurnTokens / maxContextLimit) * 100))
  const isContextHeavy = contextPercent >= 70 || actionLogs.length > 14

  return (
    <div className="h-full flex flex-col bg-[#0b0f17] text-slate-200 overflow-hidden select-text relative">
      <AgentSessionHeaderBar
        workspacePath={workspacePath}
        onSelectWorkspaceFolder={onSelectWorkspaceFolder}
        activeSession={activeSession}
        workspaceSessions={workspaceSessions}
        activeSessionId={activeSessionId}
        onCreateSession={onCreateSession}
        onSwitchSession={onSwitchSession}
        onDeleteSession={onDeleteSession}
        onRenameSession={onRenameSession}
        showWorkspaceSidebar={showWorkspaceSidebar}
        onToggleWorkspaceSidebar={onToggleWorkspaceSidebar}
        filesCount={filesCount}
        isExecuting={isExecuting}
        currentStep={currentStep}
        maxSteps={maxSteps}
      />

      <AgentTimeline
        actionLogs={actionLogs}
        activeSession={activeSession}
        setAgentPrompt={setAgentPrompt}
        activeModelName={activeModelName}
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
        plan={plan}
        isGeneratingPlan={isGeneratingPlan}
        countdownSeconds={countdownSeconds}
        isAutoProceedPaused={isAutoProceedPaused}
        autoProceedEnabled={autoProceedEnabled}
        interviewQuestions={interviewQuestions}
        isInterviewActive={isInterviewActive}
        isAnalyzingInterview={isAnalyzingInterview}
        onConfirmInterview={onConfirmInterview}
        onSkipInterview={onSkipInterview}
        onApprovePlan={onApprovePlan}
        onRejectPlan={onRejectPlan}
        onTogglePauseAutoProceed={onTogglePauseAutoProceed}
      />

      <PromptComposer
        agentPrompt={agentPrompt}
        setAgentPrompt={setAgentPrompt}
        onExecute={onExecute}
        onCancel={onCancel}
        isExecuting={isExecuting}
        queueLength={promptQueue.length}
        agentMode={agentMode}
        setAgentMode={setAgentMode}
        autoScroll={autoScroll}
        onToggleAutoScroll={handleToggleAutoScroll}
        onResetSession={onResetSession}
        onGeneratePlan={onGeneratePlan}
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
        autoInstallHubSkills={autoInstallHubSkills}
        onToggleAutoInstallSkills={handleToggleAutoInstallSkills}
      />
    </div>
  )
}
