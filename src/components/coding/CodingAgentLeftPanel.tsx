import React from 'react'
import { PanelLeft } from 'lucide-react'
import { AppSettings, DiagnosticsData } from '../../types'
import { AgentActionLogPanel } from './AgentActionLogPanel'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { usePlanApproval } from '../../hooks/usePlanApproval'
import { useTranslation } from '../../i18n'

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
  autoScroll: boolean
  onToggleAutoScroll: () => void
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
  autoScroll,
  onToggleAutoScroll,
}) => {
  const { t } = useTranslation()

  return (
    <div style={{ width: `${leftPanelWidth}px` }} className="flex flex-col border-r border-slate-800 bg-slate-950 shrink-0 overflow-hidden">
      {/* Sub-toolbar: Workspace trigger & conversation status */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs shrink-0">
        <button
          type="button"
          onClick={onToggleWorkspaceSidebar}
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
        />
      </div>
    </div>
  )
}
