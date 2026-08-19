import React from 'react'
import { AgentActionLog, IngestedDocument, WorkspaceFile, AppSettings, CodingSession, AgentChangeMetrics } from '../../types'
import { AgentMode } from './CodingAgentView'
import { QueuedPrompt } from '../../hooks/useCodingAgent'
import { useAgentTimelineScroll } from '../../hooks/useAgentTimelineScroll'
import { AgentSessionHeaderBar } from './AgentSessionHeaderBar'
import { AgentTimeline } from './AgentTimeline'
import { PromptQueueCard } from './PromptQueueCard'
import { ChangeMetricsBar } from './ChangeMetricsBar'
import { ContextUsageBanner } from './ContextUsageBanner'
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
  onExecute: () => void
  onCancel: () => void
  pinnedFiles: Map<string, WorkspaceFile>
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
  onResetSession?: () => void
  onCompactContext?: () => void
  /** Drafts a plan from the current prompt without changing agentMode or replacing normal send. */
  onGeneratePlan?: () => void
  /** Shows a badge on the "Genera piano" icon when there are un-consolidated pending milestones. */
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
  /** Aggregate size of the file changes applied so far in this session. */
  changeMetrics?: AgentChangeMetrics
  /** Shared with other agent-opened panels (e.g. CodingTerminal) so one toggle governs autoscroll everywhere. */
  autoScroll: boolean
  onToggleAutoScroll: () => void
}

export const AgentActionLogPanel: React.FC<AgentActionLogPanelProps> = ({
  actionLogs,
  agentMode,
  setAgentMode,
  agentPrompt,
  setAgentPrompt,
  isExecuting,
  streamingText = '',
  onExecute,
  onCancel,
  pinnedFiles,
  ingestedDocs,
  attachedDocIds,
  onToggleAttachDoc,
  selectedFile,
  activeModelName,
  settings,
  onOpenFile,
  promptQueue = [],
  onRemoveFromQueue,
  onEditPromptInQueue,
  onOpenPromptModal,
  onOpenSkillHubModal,
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
}) => {
  const { bottomRef, scrollContainerRef, isScrolledUp, handleScroll, scrollToBottom, handleToggleAutoScroll } =
    useAgentTimelineScroll(actionLogs, streamingText, isExecuting, autoScroll, onToggleAutoScroll)

  // Context window tracking (reflecting actual turn prompt assembly: max 8 steps + system + prompt)
  const maxContextLimit = settings?.hardwareProfile === 'High' ? 48000 : settings?.hardwareProfile === 'Low' ? 16000 : 28000
  const recentLogs = actionLogs.slice(-8)
  const estimatedTurnChars = Math.min(
    maxContextLimit,
    2500 + agentPrompt.length + recentLogs.reduce((acc, log) => acc + log.message.length + Math.min(log.detail?.length || 0, 1200), 0)
  )
  const contextPercent = Math.min(100, Math.round((estimatedTurnChars / maxContextLimit) * 100))
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
      />

      <AgentTimeline
        actionLogs={actionLogs}
        activeSession={activeSession}
        setAgentPrompt={setAgentPrompt}
        activeModelName={activeModelName}
        onOpenFile={onOpenFile}
        isExecuting={isExecuting}
        streamingText={streamingText}
        scrollContainerRef={scrollContainerRef}
        bottomRef={bottomRef}
        isScrolledUp={isScrolledUp}
        onScroll={handleScroll}
        onScrollToBottom={() => scrollToBottom(true)}
      />

      <PromptQueueCard
        promptQueue={promptQueue}
        onRemoveFromQueue={onRemoveFromQueue}
        onEditPromptInQueue={onEditPromptInQueue}
      />

      <ChangeMetricsBar changeMetrics={changeMetrics} />

      <ContextUsageBanner
        isVisible={isContextHeavy}
        estimatedTurnChars={estimatedTurnChars}
        maxContextLimit={maxContextLimit}
        contextPercent={contextPercent}
        isExecuting={isExecuting}
        onCompactContext={onCompactContext}
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
        onOpenSkillHubModal={onOpenSkillHubModal}
        onOpenPromptModal={onOpenPromptModal}
      />
    </div>
  )
}
