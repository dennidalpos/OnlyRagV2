import React from 'react'
import { AgentActionLog, IngestedDocument, WorkspaceFile, AppSettings, CodingSession, AgentChangeMetrics, InterviewQuestion, UserInterviewAnswer, AgentMode, DiagnosticsData } from '../../types'
import type { AgentPlan } from '../../hooks/usePlanApproval'
import type { QueuedPrompt } from '../../hooks/useCodingAgent'
import { useAgentTimelineScroll } from '../../hooks/useAgentTimelineScroll'
import { estimateTokenCount } from '../../lib/tokenEstimate'
import { resolveMaxContextTokens } from '../../../shared/domain/hardware/hardwareProfileTiers'
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
  diagnostics?: DiagnosticsData | null
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
  diagnostics,
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
  const autoInstallHubSkills = settings?.autoInstallHubSkills || 'disabled'
  const handleToggleAutoInstallSkills = onUpdateSettings
    ? () => {
        const nextVal = autoInstallHubSkills === 'prompt' ? 'disabled' : 'prompt'
        onUpdateSettings({
          autoInstallHubSkills: nextVal,
          enableSkillRouter: true,
        })
      }
    : undefined

  const { bottomRef, scrollContainerRef, isScrolledUp, handleScroll, scrollToBottom, handleToggleAutoScroll } =
    useAgentTimelineScroll(actionLogs, streamingText, isExecuting, autoScroll, onToggleAutoScroll)

  // Context window tracking (dynamic RAM-aware hardware limit, single source of truth with backend)
  const maxContextLimit = React.useMemo(() => {
    const facts = diagnostics
      ? {
          hasGpu: diagnostics.gpu.hasNvidiaGpu,
          vramTotalMB: diagnostics.gpu.vramTotalMB || 0,
          systemRamGB: Math.round(diagnostics.memory.totalRAMGB || 8),
          cpuCount: diagnostics.system.cpusCount || 4,
        }
      : {}
    return resolveMaxContextTokens('Auto', facts)
  }, [diagnostics])

  const BASE_PROMPT_OVERHEAD_TOKENS = 650
  const recentLogsTokens = React.useMemo(() => {
    const recentLogs = actionLogs.slice(-8)
    return recentLogs.reduce((acc, log) => acc + estimateTokenCount(log.message) + estimateTokenCount((log.detail || '').slice(0, 1200)), 0)
  }, [actionLogs])
  const deferredPrompt = React.useDeferredValue(agentPrompt)
  const promptTokens = React.useMemo(() => estimateTokenCount(deferredPrompt), [deferredPrompt])
  const estimatedTurnTokens = Math.min(maxContextLimit, BASE_PROMPT_OVERHEAD_TOKENS + promptTokens + recentLogsTokens)
  const contextPercent = Math.min(100, Math.round((estimatedTurnTokens / maxContextLimit) * 100))
  const isContextHeavy = contextPercent >= 70 || (contextPercent >= 50 && actionLogs.length > 25)

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
