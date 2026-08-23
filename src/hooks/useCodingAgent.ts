import { useState, useEffect, useRef, useCallback } from 'react'
import { AgentActionLog, AgentPlan, AppSettings, IngestedDocument, ExecutedPromptOutcome, AgentChangeMetrics, AgentMode } from '../types'
import { useIngestedDocuments } from './useIngestedDocuments'
import { useSessionHistory } from './useSessionHistory'
import { useWorkspaceProjects } from './useWorkspaceProjects'
import { useWorkspaceFiles } from './useWorkspaceFiles'
import { useAgentTerminal } from './useAgentTerminal'
import { useGitStatus } from './useGitStatus'
import { useGrepSearch } from './useGrepSearch'
import { useGuestOsDiagnostics } from './useGuestOsDiagnostics'
import { useAgentApprovals } from './useAgentApprovals'
import { useAgentPromptQueue, type QueuedPrompt } from './useAgentPromptQueue'
import { acquireGlobalTaskLock, releaseGlobalTaskLock, peekGlobalTaskLock } from '../services/globalTaskLock'
import { soundEffectsService } from '../services/soundEffectsService'
import { logger } from '../lib/logger'
import { normalizeError } from '../lib/errors/errorNormalizer'

export type { QueuedPrompt }

const EMPTY_PLANS: AgentPlan[] = []

/**
 * Composition root of the Coding Agent Studio: coordinates the agent loop, workspace, editor,
 * terminal, git, grep, approvals, queue and session-history hooks.
 */
export function useCodingAgent(settings?: AppSettings) {
  const [agentMode, setAgentModeState] = useState<AgentMode>('plan')
  const [activeTab, setActiveTab] = useState<'editor' | 'terminal' | 'git_diff' | 'grep_search' | 'activities' | 'plan' | 'slm_diagnostics'>('editor')
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)

  // Agent Execution State
  const [agentPrompt, setAgentPrompt] = useState<string>('')
  const [actionLogs, setActionLogs] = useState<AgentActionLog[]>([])
  const [isExecuting, setIsExecuting] = useState<boolean>(false)

  const addActionLog = useCallback(
    (type: AgentActionLog['type'], message: string, detail?: string, meta?: Partial<AgentActionLog>) => {
      setActionLogs((prev) => [
        ...prev,
        {
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type,
          message,
          detail,
          timestamp: new Date().toLocaleTimeString(),
          ...meta,
        },
      ])
    },
    []
  )

  const setAgentMode = useCallback((newMode: AgentMode) => {
    setAgentModeState(newMode)
  }, [])

  useEffect(() => {
    if (isExecuting) {
      acquireGlobalTaskLock('coding')
      return () => releaseGlobalTaskLock('coding')
    }
    releaseGlobalTaskLock('coding')
  }, [isExecuting])

  const [activeSkills, setActiveSkills] = useState<string[]>([])
  const [streamingText, setStreamingText] = useState<string>('')
  const [currentStatusText, setCurrentStatusText] = useState<string>('')
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [maxSteps, setMaxSteps] = useState<number | string>(50)
  const [changeMetrics, setChangeMetrics] = useState<AgentChangeMetrics>({ filesTouched: 0, additions: 0, deletions: 0 })
  const [currentLiveModel, setCurrentLiveModel] = useState<string | null>(null)

  // Modular Approvals Hook
  const {
    pendingApproval,
    setPendingApproval,
    clearPendingApproval,
  } = useAgentApprovals()

  // Modular Prompt Queue Hook
  const handleQueueNotice = useCallback((msg: string) => addActionLog('info', msg), [addActionLog])
  const {
    promptQueue,
    addToPromptQueue,
    removeFromPromptQueue,
    editPromptInQueue,
    movePromptInQueue,
    dequeueNextPrompt,
    clearPromptQueue,
  } = useAgentPromptQueue(handleQueueNotice)

  // Attached RAG documents
  const [attachedDocIds, setAttachedDocIds] = useState<Set<string>>(new Set())
  const [showDocPicker, setShowDocPicker] = useState<boolean>(false)

  const handleDocsUpdated = useCallback((docs: IngestedDocument[]) => {
    setAttachedDocIds((prev) => {
      const next = new Set<string>()
      const validIds = new Set(docs.map((d) => d.id))
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id)
      })
      return next
    })
  }, [])

  const { documents: ingestedDocs } = useIngestedDocuments({
    onDocsUpdated: handleDocsUpdated,
  })

  const ingestedDocsRef = useRef(ingestedDocs)
  useEffect(() => {
    ingestedDocsRef.current = ingestedDocs
  }, [ingestedDocs])

  // Workspace projects, file tree/editor, terminal, git, grep and host diagnostics
  const {
    projects,
    workspacePath,
    isStandaloneMode,
    handleSelectProject,
    handleAddProject,
    handleRemoveProject,
    handleSelectWorkspaceFolder,
    handleToggleStandalone,
  } = useWorkspaceProjects(settings)

  const handlePathPurged = useCallback((isInsideDeletedPath: (filePath: string) => boolean) => {
    setAttachedDocIds((prev) => {
      const next = new Set(prev)
      for (const docId of next) {
        const doc = ingestedDocsRef.current.find((d) => d.id === docId)
        if (doc?.filePath && isInsideDeletedPath(doc.filePath)) next.delete(docId)
      }
      return next
    })
  }, [])

  const handleFileNotice = useCallback((message: string) => addActionLog('info', message), [addActionLog])

  const {
    files,
    openFiles,
    selectedFile,
    editorContent,
    setEditorContent,
    originalContent,
    isSaved,
    setIsSaved,
    pinnedFiles,
    loadWorkspaceFiles,
    handleOpenFile,
    handleCloseFile,
    handleSaveFile,
    handleTogglePinFile,
    purgeFileReferences,
    setPinnedFiles,
  } = useWorkspaceFiles({
    workspacePath,
    isStandaloneMode,
    onFileNotice: handleFileNotice,
    onPathPurged: handlePathPurged,
  })

  const handleCommandNotice = useCallback(
    (command: string, output: string) => {
      addActionLog(
        'terminal',
        `Command execution notice for "${command}":`,
        `Command output indicates tool or executable is not installed on Windows PATH or exited with error.\n${output.slice(0, 300)}`
      )
    },
    [addActionLog]
  )

  const {
    terminalInput,
    setTerminalInput,
    terminalLogs,
    appendTerminalLogs,
    handleRunTerminalCommand,
    handleClearTerminal,
    navigateHistory,
  } = useAgentTerminal({ workspacePath, onCommandNotice: handleCommandNotice })

  const { gitStatusLines, gitDiffText, isFetchingGit, fetchGitStatusAndDiff } = useGitStatus(workspacePath)
  const {
    grepQuery,
    setGrepQuery,
    grepIsRegex,
    setGrepIsRegex,
    grepCaseInsensitive,
    setGrepCaseInsensitive,
    grepResults,
    isSearchingGrep,
    handleRunGrepSearch,
  } = useGrepSearch(workspacePath, isStandaloneMode)
  const { guestOsInfo, isInspectingOs, loadGuestOsInfo } = useGuestOsDiagnostics()

  // Session History
  const {
    sessions: workspaceSessions,
    activeSession,
    activeSessionId,
    createSession,
    switchSession,
    deleteSession,
    clearSessions,
    renameSession,
    updateSessionPlans,
    beginExecutedPrompt,
    completeExecutedPrompt,
  } = useSessionHistory(workspacePath)

  const prevSessionIdRef = useRef<string>('')
  useEffect(() => {
    if (activeSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = activeSessionId
      setActionLogs(activeSession?.actionLogs || [])
      setStreamingText('')
      clearPendingApproval()
      setCurrentStep(0)
    }
  }, [activeSessionId, activeSession, clearPendingApproval])

  const completeExecutedPromptRef = useRef(completeExecutedPrompt)
  useEffect(() => {
    completeExecutedPromptRef.current = completeExecutedPrompt
  }, [completeExecutedPrompt])

  const runningExecutedPromptRef = useRef<{ sessionId: string; promptId: string } | null>(null)
  const currentStepRef = useRef<number>(0)
  const changeMetricsRef = useRef<AgentChangeMetrics>({ filesTouched: 0, additions: 0, deletions: 0 })

  const shellCommandTimerRef = useRef<NodeJS.Timeout | null>(null)
  const previousTabRef = useRef<string | null>(null)
  const autoOpenedTerminalRef = useRef<boolean>(false)
  const activeTabRef = useRef(activeTab)

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    loadGuestOsInfo()
  }, [])

  useEffect(() => {
    setChangeMetrics({ filesTouched: 0, additions: 0, deletions: 0 })
    setStreamingText('')
    clearPendingApproval()
    setCurrentStep(0)
  }, [workspacePath, clearPendingApproval])

  const toggleAttachDoc = (docId: string) => {
    setAttachedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  // Subscribe to Agent IPC Events
  useEffect(() => {
    if (!window.electronAPI) return

    const unsubLog = window.electronAPI.onAgentLog?.((log: AgentActionLog) => {
      setActionLogs((prev) => [...prev, log])

      if (log.modelName) {
        setCurrentLiveModel(log.modelName)
      } else if ((log as any).meta?.modelName) {
        setCurrentLiveModel((log as any).meta.modelName)
      }

      if (log.type === 'tool_call') {
        setStreamingText('')
        setCurrentStatusText(log.message)
      }

      if (log.type === 'terminal' && log.detail) {
        appendTerminalLogs(`\n${log.detail}\n`)
        if (
          log.detail.includes('Exit Code: 1') ||
          log.detail.includes('error') ||
          log.detail.includes('Cannot create a project') ||
          log.detail.includes('Error:')
        ) {
          soundEffectsService.play('error', settings?.enableSoundEffects !== false)
        }
      }

      if (
        log.type === 'info' &&
        (log.detail?.includes('Circuit Breaker Triggered') ||
          log.message.includes('LLM Stream error') ||
          (log as any).category === 'system_alert')
      ) {
        soundEffectsService.play('error', settings?.enableSoundEffects !== false)
      }

      if (log.type === 'tool_call' && log.message.includes('run_command')) {
        if (shellCommandTimerRef.current) {
          clearTimeout(shellCommandTimerRef.current)
          shellCommandTimerRef.current = null
        }
        shellCommandTimerRef.current = setTimeout(() => {
          if (activeTabRef.current !== 'terminal') {
            previousTabRef.current = activeTabRef.current
            autoOpenedTerminalRef.current = true
            setActiveTab('terminal')
          }
          shellCommandTimerRef.current = null
        }, 5000)
      } else if (log.type === 'tool_call' || log.type === 'info') {
        if (shellCommandTimerRef.current) {
          clearTimeout(shellCommandTimerRef.current)
          shellCommandTimerRef.current = null
        }
        if (autoOpenedTerminalRef.current) {
          const prevTab = (previousTabRef.current || 'editor') as any
          setActiveTab(prevTab)
          autoOpenedTerminalRef.current = false
          previousTabRef.current = null
        }
      }
    })

    const unsubFileDeleted = window.electronAPI.onWorkspaceFileDeleted?.((data: { filePath: string }) => {
      purgeFileReferences(data.filePath)
    })

    const unsubStreamToken = window.electronAPI.onAgentStreamToken?.((data: { step: number; chunk: string }) => {
      if (data.chunk) {
        setStreamingText((prev) => prev + data.chunk)
      }
    })

    const unsubStep = window.electronAPI.onAgentStepUpdate?.((data: { step: number; maxSteps?: number; maxStepsLabel?: string; statusText?: string }) => {
      currentStepRef.current = data.step
      setCurrentStep(data.step)
      setStreamingText('')
      if (data?.statusText) {
        setCurrentStatusText(data.statusText)
      }
      if (data?.maxStepsLabel !== undefined) setMaxSteps(data.maxStepsLabel)
      else if (data?.maxSteps !== undefined) setMaxSteps(data.maxSteps)
    })

    const unsubApproval = window.electronAPI.onAgentApprovalRequest?.((req: any) => {
      setPendingApproval(req)
      if (req) {
        soundEffectsService.play('interactive', settings?.enableSoundEffects !== false)
      }
    })

    const unsubSkills = window.electronAPI.onAgentSkillsMatched?.((data: { skills: string[] }) => {
      setActiveSkills(data.skills || [])
    })

    const unsubChangeMetrics = window.electronAPI.onAgentChangeMetrics?.((data: AgentChangeMetrics) => {
      if (data) {
        changeMetricsRef.current = data
        setChangeMetrics(data)
      }
    })

    const unsubDone = window.electronAPI.onAgentDone?.((res: { success: boolean; summary: string }) => {
      soundEffectsService.play(res?.success === false ? 'error' : 'completion', settings?.enableSoundEffects !== false)
      setCurrentLiveModel(null)
      closeRunningExecutedPrompt(res?.success === false ? 'failed' : 'success', res?.summary)
      setIsExecuting(false)
      setStreamingText('')
      setCurrentStatusText('')

      if (shellCommandTimerRef.current) {
        clearTimeout(shellCommandTimerRef.current)
        shellCommandTimerRef.current = null
      }
      if (autoOpenedTerminalRef.current) {
        const prevTab = (previousTabRef.current || 'editor') as any
        setActiveTab(prevTab)
        autoOpenedTerminalRef.current = false
        previousTabRef.current = null
      }

      const nextItem = dequeueNextPrompt()
      if (nextItem) {
        setTimeout(() => {
          executeTask(nextItem.prompt)
        }, 300)
      }
    })

    return () => {
      unsubLog?.()
      unsubFileDeleted?.()
      unsubStreamToken?.()
      unsubStep?.()
      unsubApproval?.()
      unsubSkills?.()
      unsubChangeMetrics?.()
      unsubDone?.()
    }
  }, [dequeueNextPrompt, appendTerminalLogs, purgeFileReferences, setPendingApproval, settings?.enableSoundEffects])

  const handleCancelAgent = () => {
    setIsExecuting(false)
    setCurrentLiveModel(null)
    if (window.electronAPI) {
      if (window.electronAPI.cancelAgentTask) window.electronAPI.cancelAgentTask()
      if (window.electronAPI.cancelOllamaStream) window.electronAPI.cancelOllamaStream()
    }
    closeRunningExecutedPrompt('cancelled')
    addActionLog('info', 'Esecuzione interrotta dall\'utente.')
  }

  const resetSessionViewState = () => {
    if (isExecuting && window.electronAPI) {
      if (window.electronAPI.cancelAgentTask) window.electronAPI.cancelAgentTask()
      if (window.electronAPI.cancelOllamaStream) window.electronAPI.cancelOllamaStream()
    }
    runningExecutedPromptRef.current = null
    setIsExecuting(false)
    setAgentPrompt('')
    setActiveSkills([])
    setChangeMetrics({ filesTouched: 0, additions: 0, deletions: 0 })
    clearPendingApproval()
  }

  const handleCreateSession = () => {
    resetSessionViewState()
    createSession()
    setActionLogs([])
    clearPromptQueue()
    setAttachedDocIds(new Set())
    setPinnedFiles(new Map())
  }

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId === activeSessionId) return
    resetSessionViewState()
    switchSession(sessionId)
  }

  const jumpToProjectAndSession = (targetWorkspacePath: string, sessionId: string) => {
    if (targetWorkspacePath === workspacePath) {
      handleSwitchSession(sessionId)
      return
    }
    resetSessionViewState()
    handleSelectProject(targetWorkspacePath)
    setTimeout(() => {
      switchSession(sessionId)
    }, 150)
  }

  const handleDeleteSession = (sessionId: string) => {
    if (sessionId === activeSessionId) {
      resetSessionViewState()
      setActionLogs([])
      clearPromptQueue()
      setAttachedDocIds(new Set())
      setPinnedFiles(new Map())
    }
    deleteSession(sessionId)
  }

  const handleClearSessionHistory = () => {
    resetSessionViewState()
    clearSessions()
    setActionLogs([])
    clearPromptQueue()
    setAttachedDocIds(new Set())
    setPinnedFiles(new Map())
  }

  const handleRenameSession = (sessionId: string, newTitle: string) => {
    renameSession(sessionId, newTitle)
  }

  const handleNewSession = handleCreateSession

  const activeSessionPlans = activeSession?.plans || EMPTY_PLANS
  const updateActiveSessionPlans = useCallback(
    (updater: (prev: AgentPlan[]) => AgentPlan[]) => {
      if (!activeSessionId) return
      updateSessionPlans(activeSessionId, updater)
    },
    [activeSessionId, updateSessionPlans]
  )

  const closeRunningExecutedPrompt = (outcome: ExecutedPromptOutcome, summary?: string) => {
    const running = runningExecutedPromptRef.current
    if (!running) return
    runningExecutedPromptRef.current = null
    completeExecutedPromptRef.current(running.sessionId, running.promptId, {
      outcome,
      totalSteps: currentStepRef.current,
      metrics: changeMetricsRef.current,
      summary,
    })
  }

  const executeTask = async (taskPrompt: string, overrideMode?: AgentMode) => {
    if (!taskPrompt.trim() || !window.electronAPI) return

    const busyModule = peekGlobalTaskLock()
    if (busyModule && busyModule !== 'coding') {
      const busyModuleName = busyModule === 'ingestion' ? 'Ingestione Documenti' : 'Traduzione'
      addActionLog('info', `Impossibile avviare: ${busyModuleName} ha un task in corso. Attendi che finisca prima di procedere.`)
      return
    }

    setIsExecuting(true)
    setActiveSkills([])
    setChangeMetrics({ filesTouched: 0, additions: 0, deletions: 0 })
    changeMetricsRef.current = { filesTouched: 0, additions: 0, deletions: 0 }
    currentStepRef.current = 0
    addActionLog('info', `User Prompt: ${taskPrompt}`, undefined, { category: 'user_prompt' })

    const effectiveMode = overrideMode || agentMode
    const runSessionId = activeSessionId || activeSession?.id || ''
    if (runSessionId) {
      runningExecutedPromptRef.current = {
        sessionId: runSessionId,
        promptId: beginExecutedPrompt(runSessionId, taskPrompt, effectiveMode),
      }
    }

    try {
      const activeModel = settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b'
      const contextFiles = Array.from(pinnedFiles.values()).map((f) => ({
        path: f.path,
        name: f.name,
      }))

      if (selectedFile && !pinnedFiles.has(selectedFile.path)) {
        contextFiles.push({
          path: selectedFile.path,
          name: selectedFile.name,
        })
      }

      const attachedDocs = ingestedDocs
        .filter((d) => attachedDocIds.has(d.id))
        .map((d) => ({
          id: d.id,
          filename: d.filename,
          extractedMarkdown: d.extractedMarkdown || '',
        }))

      const resolvedPinnedFiles = await Promise.all(
        Array.from(pinnedFiles.values()).map(async (f) => {
          let content = selectedFile && selectedFile.path === f.path ? editorContent : ''
          if (!content && window.electronAPI?.readWorkspaceFile) {
            try {
              const res = await window.electronAPI.readWorkspaceFile(f.path)
              if (res.success && res.content) {
                content = res.content
              }
            } catch (err: any) {
              logger.warn('useCodingAgent', `Error reading pinned file ${f.path}: ${err?.message}`)
            }
          }
          return { name: f.name, path: f.path, content }
        })
      )

      const initialLog = actionLogs.find((l) => l.message.startsWith('User Prompt: '))
      const initialUserTask = initialLog ? initialLog.message.replace(/^User Prompt:\s*/, '') : taskPrompt

      const res = await window.electronAPI.startAgentTask({
        sessionId: runSessionId,
        userTask: taskPrompt,
        initialUserTask,
        agentMode: effectiveMode,
        workspacePath: isStandaloneMode ? null : workspacePath,
        isStandaloneMode,
        activeModel,
        contextFiles,
        pinnedFiles: resolvedPinnedFiles,
        attachedDocs,
        settings,
      })

      if (!res?.success) {
        const normalized = normalizeError(res?.error || 'Errore sconosciuto', 'Coding Agent')
        closeRunningExecutedPrompt('failed', normalized.message)
        setIsExecuting(false)
        addActionLog('info', `Errore avvio task: ${normalized.message}${normalized.remediation ? ` — ${normalized.remediation}` : ''}`)
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Coding Agent')
      closeRunningExecutedPrompt('failed', normalized.message)
      setIsExecuting(false)
      addActionLog('info', `Errore esecuzione: ${normalized.message}${normalized.remediation ? ` — ${normalized.remediation}` : ''}`)
    }
  }

  const handleAgentExecute = async (overridePrompt?: string, overrideMode?: AgentMode) => {
    const text = typeof overridePrompt === 'string' ? overridePrompt : agentPrompt
    if (!text.trim()) return

    const isOverride = typeof overridePrompt === 'string'
    if (isExecuting) {
      addToPromptQueue(text)
      if (!isOverride) setAgentPrompt('')
      return
    }

    if (!isOverride) setAgentPrompt('')
    await executeTask(text, overrideMode)
  }

  const FILE_MUTATION_APPROVAL_TYPES = new Set(['write_file', 'replace_chunk', 'multi_replace', 'delete_file'])

  const handleApproveAction = async (approvedHunkIndices?: number[]) => {
    if (!pendingApproval || !window.electronAPI?.respondToAgentApproval) return
    const current = pendingApproval
    clearPendingApproval()
    const partialNote = approvedHunkIndices ? ` (${approvedHunkIndices.length} hunk selezionati)` : ''
    addActionLog('tool_call', `User approved ${current.type}: ${current.target}${partialNote}`)
    await window.electronAPI.respondToAgentApproval(current.sessionId, true, approvedHunkIndices)
    if (FILE_MUTATION_APPROVAL_TYPES.has(current.type) && selectedFile && selectedFile.path === current.target) {
      setTimeout(() => handleOpenFile(selectedFile), 400)
    }
  }

  const handleRejectAction = async () => {
    if (!pendingApproval) return
    const current = pendingApproval
    clearPendingApproval()
    addActionLog('info', `User rejected ${current.type}: ${current.target}`)
    await window.electronAPI?.respondToAgentApproval?.(current.sessionId, false)
  }

  const compactContext = useCallback(() => {
    if (actionLogs.length === 0) return
    const recentLogs = actionLogs.slice(-6)
    const summaryLog: AgentActionLog = {
      id: `compacted-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `🧹 Session Context Compacted: Pruned older action steps (${actionLogs.length - recentLogs.length} entries removed) to optimize context window headroom.`,
    }
    setActionLogs([summaryLog, ...recentLogs])
  }, [actionLogs])

  return {
    agentMode,
    setAgentMode,
    activeTab,
    setActiveTab,
    isPromptModalOpen,
    setIsPromptModalOpen,
    gitStatusLines,
    gitDiffText,
    changeMetrics,
    isFetchingGit,
    guestOsInfo,
    isInspectingOs,
    projects,
    handleAddProject,
    handleRemoveProject,
    handleSelectProject,
    grepQuery,
    setGrepQuery,
    grepIsRegex,
    setGrepIsRegex,
    grepCaseInsensitive,
    setGrepCaseInsensitive,
    grepResults,
    isSearchingGrep,
    workspacePath,
    isStandaloneMode,
    files,
    openFiles,
    selectedFile,
    editorContent,
    setEditorContent,
    originalContent,
    isSaved,
    setIsSaved,
    ingestedDocs,
    attachedDocIds,
    showDocPicker,
    setShowDocPicker,
    terminalInput,
    setTerminalInput,
    terminalLogs,
    pinnedFiles,
    agentPrompt,
    setAgentPrompt,
    promptQueue,
    addToPromptQueue,
    removeFromPromptQueue,
    editPromptInQueue,
    movePromptInQueue,
    actionLogs,
    isExecuting,
    currentLiveModel,
    currentStep,
    maxSteps,
    activeSkills,
    streamingText,
    currentStatusText,
    pendingApproval,
    setPendingApproval,
    handleRunGrepSearch,
    loadWorkspaceFiles,
    fetchGitStatusAndDiff,
    handleSelectWorkspaceFolder,
    handleToggleStandalone,
    toggleAttachDoc,
    handleTogglePinFile,
    handleOpenFile,
    handleCloseFile,
    handleSaveFile,
    handleRunTerminalCommand,
    handleClearTerminal,
    navigateHistory,
    handleAgentExecute,
    handleCancelAgent,
    workspaceSessions,
    activeSessionId,
    activeSession,
    activeSessionPlans,
    updateActiveSessionPlans,
    handleCreateSession,
    handleSwitchSession,
    jumpToProjectAndSession,
    handleDeleteSession,
    handleClearSessionHistory,
    handleRenameSession,
    handleNewSession,
    handleApproveAction,
    handleRejectAction,
    compactContext,
    addActionLog,
  }
}
