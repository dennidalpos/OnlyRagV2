import { useCallback, useEffect } from 'react'
import type { AppSettings } from '../types'
import { useSessionHistory } from './useSessionHistory'
import { useWorkspaceProjects } from './useWorkspaceProjects'
import { useWorkspaceFiles } from './useWorkspaceFiles'
import { useGitStatus } from './useGitStatus'
import { useGuestOsDiagnostics } from './useGuestOsDiagnostics'
import type { QueuedPrompt } from './useAgentPromptQueue'
import { useAgentActionLog } from './codingAgent/useAgentActionLog'
import { useCodingAgentAttachments } from './codingAgent/useCodingAgentAttachments'
import { useCodingAgentTerminal } from './codingAgent/useCodingAgentTerminal'
import { useCodingAgentExecution } from './codingAgent/useCodingAgentExecution'
import { useActiveSessionPlans, useCodingAgentSession } from './codingAgent/useCodingAgentSession'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { useTranslation } from '../i18n'

export type { QueuedPrompt }

/**
 * Composition root of the Coding Agent Studio: wires workspace, editor, attachments, terminal, git,
 * execution and session hooks. Each concern lives in its own hook under hooks/codingAgent/.
 */
export function useCodingAgent(settings?: AppSettings) {
  const { t } = useTranslation()
  const actionLog = useAgentActionLog()
  const { addActionLog } = actionLog

  const {
    projects,
    workspacePath,
    isStandaloneMode,
    handleSelectProject,
    handleAddProject,
    handleRenameProject,
    handleOpenProjectPath,
    handleRemoveProject: unregisterProject,
    handleSelectWorkspaceFolder,
  } = useWorkspaceProjects(settings)

  const attachments = useCodingAgentAttachments()

  const handleFileNotice = useCallback((message: string) => addActionLog('info', message), [addActionLog])
  const workspaceFiles = useWorkspaceFiles({
    workspacePath,
    isStandaloneMode,
    onFileNotice: handleFileNotice,
    onPathPurged: attachments.handlePathPurged,
  })
  const { purgeFileReferences, resetWorkspaceFiles, loadWorkspaceFiles, setPinnedFiles } = workspaceFiles

  const handleRevealStandaloneWorkspace = useCallback(async () => {
    if (!isStandaloneMode || !workspacePath || !window.electronAPI?.openPath) return
    try {
      await window.electronAPI.openPath(workspacePath)
    } catch (err: unknown) {
      addActionLog('info', t('agentRun.scratchOpenFailed', { message: errorMessage(err) }))
    }
  }, [addActionLog, isStandaloneMode, workspacePath])

  const handleExportStandaloneWorkspace = useCallback(async () => {
    const api = window.electronAPI
    if (!isStandaloneMode || !api?.exportStandaloneScratchWorkspace || !api.openDirectoryDialog) return
    const destination = await api.openDirectoryDialog({ title: t('agentRun.scratchExportTitle') })
    if (!destination) return
    const result = await api.exportStandaloneScratchWorkspace(destination)
    if (result.success && result.path) {
      addActionLog('info', t('agentRun.scratchExported', { path: result.path }))
    } else {
      addActionLog('info', t('agentRun.scratchExportFailed', { message: result.error || t('agentRun.unknownError') }))
    }
  }, [addActionLog, isStandaloneMode])

  const handleClearStandaloneWorkspace = useCallback(async () => {
    const api = window.electronAPI
    if (!isStandaloneMode || !workspacePath || !api?.clearStandaloneScratchWorkspace) return
    const result = await api.clearStandaloneScratchWorkspace()
    if (!result.success) {
      addActionLog('info', t('agentRun.scratchClearFailed', { message: result.error || t('agentRun.unknownError') }))
      return
    }
    purgeFileReferences(workspacePath)
    resetWorkspaceFiles()
    await loadWorkspaceFiles(workspacePath)
    addActionLog('info', `Workspace scratch svuotato (${result.removedEntries} elementi rimossi).`)
  }, [addActionLog, isStandaloneMode, loadWorkspaceFiles, purgeFileReferences, resetWorkspaceFiles, workspacePath])

  const terminal = useCodingAgentTerminal({ workspacePath, addActionLog })
  const git = useGitStatus(workspacePath)
  const { guestOsInfo, loadGuestOsInfo } = useGuestOsDiagnostics()
  useEffect(() => {
    loadGuestOsInfo()
  }, [])

  const history = useSessionHistory(workspacePath)
  const plans = useActiveSessionPlans(history)

  const execution = useCodingAgentExecution({
    settings,
    workspacePath,
    isStandaloneMode,
    actionLog,
    session: {
      activeSessionId: history.activeSessionId,
      activeSession: history.activeSession,
      beginExecutedPrompt: history.beginExecutedPrompt,
      completeExecutedPrompt: history.completeExecutedPrompt,
      updateActiveSessionPlans: plans.updateActiveSessionPlans,
    },
    editor: workspaceFiles,
    context: { ingestedDocs: attachments.ingestedDocs, attachedDocIds: attachments.attachedDocIds, pinnedFiles: workspaceFiles.pinnedFiles },
    appendTerminalLogs: terminal.appendTerminalLogs,
  })

  const clearRunContext = () => {
    attachments.clearAttachedDocs()
    setPinnedFiles(new Map())
  }

  const session = useCodingAgentSession({
    workspacePath,
    history,
    execution,
    actionLogs: actionLog.actionLogs,
    clearRunContext,
    selectProject: handleSelectProject,
    removeProject: unregisterProject,
  })

  return {
    // Execution
    agentMode: execution.agentMode,
    setAgentMode: execution.setAgentMode,
    isPromptModalOpen: execution.isPromptModalOpen,
    setIsPromptModalOpen: execution.setIsPromptModalOpen,
    agentPrompt: execution.agentPrompt,
    setAgentPrompt: execution.setAgentPrompt,
    actionLogs: actionLog.actionLogs,
    addActionLog,
    isExecuting: execution.isExecuting,
    activeRunIdentity: execution.activeRunIdentity,
    currentLiveModel: execution.currentLiveModel,
    currentStep: execution.currentStep,
    maxSteps: execution.maxSteps,
    activeSkills: execution.activeSkills,
    streamingText: execution.streamingText,
    currentStatusText: execution.currentStatusText,
    changeMetrics: execution.changeMetrics,
    contextBudget: execution.contextBudget,
    pendingApproval: execution.pendingApproval,
    promptQueue: execution.promptQueue,
    removeFromPromptQueue: execution.removeFromPromptQueue,
    editPromptInQueue: execution.editPromptInQueue,
    handleAgentExecute: execution.handleAgentExecute,
    handleCancelAgent: execution.handleCancelAgent,
    handleApproveAction: execution.handleApproveAction,
    handleRejectAction: execution.handleRejectAction,
    compactContext: execution.compactContext,
    // Sessions and plans
    workspaceSessions: session.workspaceSessions,
    activeSession: session.activeSession,
    activeSessionId: session.activeSessionId,
    handleCreateSession: session.handleCreateSession,
    handleNewSession: session.handleCreateSession,
    handleSwitchSession: session.handleSwitchSession,
    jumpToProjectAndSession: session.jumpToProjectAndSession,
    handleDeleteSession: session.handleDeleteSession,
    handleRenameSession: session.handleRenameSession,
    activeSessionPlans: plans.activeSessionPlans,
    updateActiveSessionPlans: plans.updateActiveSessionPlans,
    persistActiveSessionPlan: plans.persistActiveSessionPlan,
    // Workspace, projects and host
    projects,
    workspacePath,
    isStandaloneMode,
    handleAddProject,
    handleRenameProject,
    handleOpenProjectPath,
    handleRemoveProject: session.handleRemoveProject,
    handleSelectProject,
    handleSelectWorkspaceFolder,
    handleRevealStandaloneWorkspace,
    handleExportStandaloneWorkspace,
    handleClearStandaloneWorkspace,
    guestOsInfo,
    // Editor and files
    files: workspaceFiles.files,
    openFiles: workspaceFiles.openFiles,
    selectedFile: workspaceFiles.selectedFile,
    editorContent: workspaceFiles.editorContent,
    setEditorContent: workspaceFiles.setEditorContent,
    originalContent: workspaceFiles.originalContent,
    isSaved: workspaceFiles.isSaved,
    setIsSaved: workspaceFiles.setIsSaved,
    saveConflict: workspaceFiles.saveConflict,
    pinnedFiles: workspaceFiles.pinnedFiles,
    loadWorkspaceFiles,
    handleOpenFile: workspaceFiles.handleOpenFile,
    handleCloseFile: workspaceFiles.handleCloseFile,
    handleSaveFile: workspaceFiles.handleSaveFile,
    handleReloadConflict: workspaceFiles.handleReloadConflict,
    handleMergeConflict: workspaceFiles.handleMergeConflict,
    handleOverwriteConflict: workspaceFiles.handleOverwriteConflict,
    handleTogglePinFile: workspaceFiles.handleTogglePinFile,
    // Attachments
    ingestedDocs: attachments.ingestedDocs,
    attachedDocIds: attachments.attachedDocIds,
    toggleAttachDoc: attachments.toggleAttachDoc,
    // Terminal and git
    terminalInput: terminal.terminalInput,
    setTerminalInput: terminal.setTerminalInput,
    terminalLogs: terminal.terminalLogs,
    handleRunTerminalCommand: terminal.handleRunTerminalCommand,
    handleClearTerminal: terminal.handleClearTerminal,
    navigateHistory: terminal.navigateHistory,
    gitStatusLines: git.gitStatusLines,
    gitDiffText: git.gitDiffText,
    isGitRepo: git.isGitRepo,
    isFetchingGit: git.isFetchingGit,
    fetchGitStatusAndDiff: git.fetchGitStatusAndDiff,
    initGit: git.initGit,
  }
}

export type CodingAgentState = ReturnType<typeof useCodingAgent>
