import { useState, useEffect, useRef, useCallback } from 'react'
import { AgentActionLog, AgentPlan, AppSettings, IngestedDocument, ExecutedPromptOutcome, QueuedPromptRecord, AgentChangeMetrics } from '../types'
import { AgentMode } from '../components/coding/CodingAgentView'
import { useIngestedDocuments } from './useIngestedDocuments'
import { useSessionHistory } from './useSessionHistory'
import { useWorkspaceProjects } from './useWorkspaceProjects'
import { useWorkspaceFiles } from './useWorkspaceFiles'
import { useAgentTerminal } from './useAgentTerminal'
import { useGitStatus } from './useGitStatus'
import { useGrepSearch } from './useGrepSearch'
import { useGuestOsDiagnostics } from './useGuestOsDiagnostics'
import { logger } from '../lib/logger'

export type QueuedPrompt = QueuedPromptRecord

/** Stable empty plan list, so a session without plans never re-triggers plan effects. */
const EMPTY_PLANS: AgentPlan[] = []

/**
 * Composition root of the Coding Agent Studio: owns the agent turn loop (prompt, action
 * log, approvals, metrics) and wires together the workspace, editor, terminal, git, grep
 * and session-history hooks that back the rest of the view.
 */
export function useCodingAgent(settings?: AppSettings) {
  const [agentMode, setAgentMode] = useState<AgentMode>('plan')
  const [activeTab, setActiveTab] = useState<'editor' | 'terminal' | 'git_diff' | 'grep_search' | 'activities' | 'plan' | 'slm_diagnostics'>('editor')
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)

  // Agent Execution State. Declared first: the workspace hooks below report their events
  // into the same action log through addActionLog.
  const [agentPrompt, setAgentPrompt] = useState<string>('')
  const [actionLogs, setActionLogs] = useState<AgentActionLog[]>([])
  const [isExecuting, setIsExecuting] = useState<boolean>(false)
  const [activeSkills, setActiveSkills] = useState<string[]>([])
  const [streamingText, setStreamingText] = useState<string>('')
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [maxSteps, setMaxSteps] = useState<number | string>(50)
  /** Aggregate +/- size of the file changes applied by the running agent session. */
  const [changeMetrics, setChangeMetrics] = useState<AgentChangeMetrics>({ filesTouched: 0, additions: 0, deletions: 0 })
  const [pendingApproval, setPendingApproval] = useState<{
    sessionId: string
    type: 'write_file' | 'replace_chunk' | 'multi_replace' | 'delete_file' | 'download_file' | 'terminal_cmd' | 'git_commit'
    target: string
    contentOrCmd: string
    replacement?: string
    replacements?: { targetContent: string; replacementContent: string }[]
    parameters?: Record<string, any>
  } | null>(null)

  const addActionLog = useCallback((type: AgentActionLog['type'], message: string, detail?: string) => {
    setActionLogs((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        type,
        message,
        detail,
      },
    ])
  }, [])

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

  const { documents: ingestedDocs, refetchDocuments: loadIngestedDocs } = useIngestedDocuments({
    onDocsUpdated: handleDocsUpdated,
    autoRetryIntervalMs: 3000,
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

  /** A path deleted from the workspace must also drop the documents ingested from it. */
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
        `Command output indicates tool or executable is not installed on Windows PATH or exited with error.
${output.slice(0, 300)}`
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

  // Session History (filesystem-backed, see useSessionHistory)
  const {
    sessions: workspaceSessions,
    activeSession,
    activeSessionId,
    createSession,
    switchSession,
    deleteSession,
    clearSessions,
    renameSession,
    updateSessionContent,
    updateSessionPlans,
    beginExecutedPrompt,
    completeExecutedPrompt,
  } = useSessionHistory(workspacePath)

  // The agent:done / agent:log listeners are registered once, so they reach the current
  // history callback through a ref instead of re-subscribing on every render.
  const completeExecutedPromptRef = useRef(completeExecutedPrompt)
  useEffect(() => {
    completeExecutedPromptRef.current = completeExecutedPrompt
  }, [completeExecutedPrompt])

  // Prompt Queue State
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([])
  const promptQueueRef = useRef<QueuedPrompt[]>([])
  useEffect(() => {
    promptQueueRef.current = promptQueue
  }, [promptQueue])

  /** Session whose transcript is currently loaded in the view (guards restore vs mirror). */
  const [loadedSessionId, setLoadedSessionId] = useState<string>('')
  /** ExecutedPrompt record open for the running agent task, closed by the agent:done handler. */
  const runningExecutedPromptRef = useRef<{ sessionId: string; promptId: string } | null>(null)
  /** Live step count and change metrics, readable from the IPC listeners registered once. */
  const currentStepRef = useRef<number>(0)
  const changeMetricsRef = useRef<AgentChangeMetrics>({ filesTouched: 0, additions: 0, deletions: 0 })

  // 5-Second Real-Time Shell Command Monitoring Tab State
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

  const toggleAttachDoc = (docId: string) => {
    setAttachedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  useEffect(() => {
    if (!window.electronAPI) return

    const unsubLog = window.electronAPI.onAgentLog?.((log: AgentActionLog) => {
      setStreamingText('')
      setActionLogs((prev) => {
        const filtered = prev.filter((l) => l.id !== log.id)
        return [...filtered, log].slice(-500)
      })

      // Real-time synchronization of terminal logs & 5-second trigger for live shell monitoring tab
      if (log.type === 'terminal' || log.message.includes('run_command') || log.message.startsWith('Ran ') || log.message.includes('Executing terminal command')) {
        if (log.message) {
          appendTerminalLogs(log.detail ? `${log.message}\n${log.detail}` : log.message)
        }

        // Start 5-second trigger timer for auto-opening terminal monitoring tab
        if (!shellCommandTimerRef.current) {
          if (activeTabRef.current !== 'terminal') {
            previousTabRef.current = activeTabRef.current
          }
          shellCommandTimerRef.current = setTimeout(() => {
            setActiveTab('terminal')
            autoOpenedTerminalRef.current = true
            shellCommandTimerRef.current = null
          }, 5000)
        }
      }

      // Clear shell command 5s timer if command completes
      if (
        log.message.includes('Command exited with code') ||
        log.message.includes('Finished running terminal command')
      ) {
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

      // 2. Refresh & purge references on file write/replace/delete operations
      if (log.message.includes('Successfully deleted')) {
        const match = log.message.match(/Successfully deleted (?:file|directory)?\s*(.+)/i)
        const targetPath = match ? match[1].trim() : ''
        if (targetPath) {
          purgeFileReferences(targetPath)
        } else if (workspacePath) {
          loadWorkspaceFiles(workspacePath)
        }
      } else if (
        log.message.includes('Successfully wrote file') ||
        log.message.includes('Successfully replaced')
      ) {
        if (workspacePath) {
          loadWorkspaceFiles(workspacePath)
        }
      }
    })

    const unsubFileDeleted = window.electronAPI.onWorkspaceFileDeleted?.((data: { filePath: string }) => {
      if (data?.filePath) {
        purgeFileReferences(data.filePath)
      }
    })

    const unsubDocDeleted = window.electronAPI.onIngestDocumentDeleted?.((data: { docId: string }) => {
      if (data?.docId) {
        setAttachedDocIds((prev) => {
          const next = new Set(prev)
          next.delete(data.docId)
          return next
        })
      }
    })

    const unsubStreamToken = window.electronAPI.onAgentStreamToken?.((data: { step: number; chunk: string }) => {
      if (!data?.chunk) return
      setStreamingText((prev) => prev + data.chunk)
    })

    const unsubStep = window.electronAPI.onAgentStepUpdate?.((data: { step: number; maxSteps: number; maxStepsLabel: string }) => {
      if (data?.step !== undefined) {
        currentStepRef.current = data.step
        setCurrentStep(data.step)
      }
      if (data?.maxStepsLabel !== undefined) setMaxSteps(data.maxStepsLabel)
      else if (data?.maxSteps !== undefined) setMaxSteps(data.maxSteps)
    })

    const unsubApproval = window.electronAPI.onAgentApprovalRequest?.((req: any) => {
      setPendingApproval(req)
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
      closeRunningExecutedPrompt(res?.success === false ? 'failed' : 'success', res?.summary)
      setIsExecuting(false)
      setStreamingText('')

      // Clear 5-second timer & automatically restore tab on task completion
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
      if (promptQueueRef.current.length > 0) {
        const [nextItem, ...remaining] = promptQueueRef.current
        setPromptQueue(remaining)
        promptQueueRef.current = remaining
        setTimeout(() => {
          executeTask(nextItem.prompt)
        }, 300)
      }
    })

    return () => {
      unsubLog?.()
      unsubFileDeleted?.()
      unsubDocDeleted?.()
      unsubStreamToken?.()
      unsubStep?.()
      unsubApproval?.()
      unsubSkills?.()
      unsubChangeMetrics?.()
      unsubDone?.()
    }
  }, [])

  const handleCancelAgent = () => {
    setIsExecuting(false)
    if (window.electronAPI) {
      if (window.electronAPI.cancelAgentTask) window.electronAPI.cancelAgentTask()
      if (window.electronAPI.cancelOllamaStream) window.electronAPI.cancelOllamaStream()
    }
    closeRunningExecutedPrompt('cancelled')
    addActionLog('info', 'Esecuzione interrotta dall\'utente.')
  }

  /** Stops the running task and resets the per-session view state before switching context. */
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
    setPendingApproval(null)
  }

  const handleCreateSession = () => {
    resetSessionViewState()
    const created = createSession()
    setLoadedSessionId(created.id)
    setActionLogs([])
    setPromptQueue([])
    promptQueueRef.current = []
    setAttachedDocIds(new Set())
    setPinnedFiles(new Map())
  }

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId === activeSessionId) return
    resetSessionViewState()
    switchSession(sessionId)
  }

  const handleDeleteSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) resetSessionViewState()
    const nextActive = await deleteSession(sessionId)
    if (nextActive) {
      setLoadedSessionId('')
    }
  }

  const handleClearSessionHistory = async () => {
    resetSessionViewState()
    const fresh = await clearSessions()
    setLoadedSessionId(fresh.id)
    setActionLogs([])
    setPromptQueue([])
    promptQueueRef.current = []
  }

  const handleRenameSession = (sessionId: string, newTitle: string) => {
    renameSession(sessionId, newTitle)
  }

  const handleNewSession = handleCreateSession

  /** Plan history of the active session, persisted with the session itself. */
  const activeSessionPlans = activeSession?.plans || EMPTY_PLANS
  const updateActiveSessionPlans = useCallback(
    (updater: (prev: AgentPlan[]) => AgentPlan[]) => {
      if (!activeSessionId) return
      updateSessionPlans(activeSessionId, updater)
    },
    [activeSessionId, updateSessionPlans]
  )

  /** Closes the ExecutedPrompt record of the running task with its final outcome and metrics. */
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

  const executeTask = async (taskPrompt: string) => {
    if (!taskPrompt.trim() || !window.electronAPI) return
    setIsExecuting(true)
    setActiveSkills([])
    setChangeMetrics({ filesTouched: 0, additions: 0, deletions: 0 })
    changeMetricsRef.current = { filesTouched: 0, additions: 0, deletions: 0 }
    currentStepRef.current = 0
    addActionLog('info', `User Prompt: ${taskPrompt}`)

    // Open the ExecutedPrompt record for this run; the session title is derived from
    // the first one by the history store, and `agent:done` closes it with its metrics.
    const runSessionId = activeSessionId || activeSession?.id || ''
    if (runSessionId) {
      runningExecutedPromptRef.current = {
        sessionId: runSessionId,
        promptId: beginExecutedPrompt(runSessionId, taskPrompt, agentMode),
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
        agentMode,
        workspacePath: workspacePath || undefined,
        isStandaloneMode,
        activeModel,
        contextFiles,
        attachedDocs,
        pinnedFiles: resolvedPinnedFiles,
        activeFile: selectedFile ? { name: selectedFile.name, path: selectedFile.path, content: editorContent } : null,
        settings,
      })
      if (res && res.success === false) {
        const reason = res.summary || res.error || 'Failed scheduling task'
        addActionLog('info', `Agent Scheduling Error: ${reason}`)
        closeRunningExecutedPrompt('failed', reason)
        setIsExecuting(false)
      }
    } catch (err: any) {
      addActionLog('info', `Agent Scheduling Error: ${err.message}`)
      closeRunningExecutedPrompt('failed', err.message)
      setIsExecuting(false)
    }
  }

  const handleAgentExecute = async (overridePrompt?: string | unknown) => {
    const rawPrompt = typeof overridePrompt === 'string' ? overridePrompt : agentPrompt
    const text = (rawPrompt || '').trim()
    if (!text) return

    const isOverride = typeof overridePrompt === 'string'
    if (isExecuting) {
      addToPromptQueue(text)
      if (!isOverride) setAgentPrompt('')
      return
    }

    if (!isOverride) setAgentPrompt('')
    await executeTask(text)
  }

  const addToPromptQueue = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const item: QueuedPrompt = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      prompt: trimmed,
      createdAt: new Date().toISOString(),
    }
    setPromptQueue((prev) => [...prev, item])
    addActionLog('info', `Nuovo prompt aggiunto alla coda (#${promptQueueRef.current.length + 1}): "${trimmed.slice(0, 80)}..."`)
  }

  const removeFromPromptQueue = (id: string) => {
    setPromptQueue((prev) => prev.filter((p) => p.id !== id))
  }

  const editPromptInQueue = (id: string, newPrompt: string) => {
    setPromptQueue((prev) =>
      prev.map((p) => (p.id === id ? { ...p, prompt: newPrompt } : p))
    )
  }

  const movePromptInQueue = (fromIndex: number, toIndex: number) => {
    setPromptQueue((prev) => {
      if (toIndex < 0 || toIndex >= prev.length) return prev
      const copy = [...prev]
      const [moved] = copy.splice(fromIndex, 1)
      copy.splice(toIndex, 0, moved)
      return copy
    })
  }

  // Approving/rejecting no longer re-executes the action from the renderer: it only answers
  // the main-process orchestrator loop, which is paused mid-step waiting for exactly this
  // response (see requestApproval in agentOrchestratorAppService.ts). The loop performs the
  // tool call itself through the same path every other step uses, then keeps running --
  // isExecuting must stay true and untouched here, driven onward by the agent:log /
  // agent:step-update / agent:done events already wired in the effect above.
  const FILE_MUTATION_APPROVAL_TYPES = new Set(['write_file', 'replace_chunk', 'multi_replace', 'delete_file'])

  const handleApproveAction = async () => {
    if (!pendingApproval || !window.electronAPI?.respondToAgentApproval) return
    const current = pendingApproval
    setPendingApproval(null)
    addActionLog('tool_call', `User approved ${current.type}: ${current.target}`)
    await window.electronAPI.respondToAgentApproval(current.sessionId, true)
    // Best-effort refresh of the currently open editor tab if it was the approved target --
    // the write itself now happens asynchronously in the main process, so this is a short
    // grace period rather than the synchronous re-open the old renderer-side execution allowed.
    if (FILE_MUTATION_APPROVAL_TYPES.has(current.type) && selectedFile && selectedFile.path === current.target) {
      setTimeout(() => handleOpenFile(selectedFile), 400)
    }
  }

  const handleRejectAction = async () => {
    if (!pendingApproval) return
    const current = pendingApproval
    setPendingApproval(null)
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
    currentStep,
    maxSteps,
    activeSkills,
    streamingText,
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
    handleAgentExecute,
    handleCancelAgent,
    workspaceSessions,
    activeSessionId,
    activeSession,
    activeSessionPlans,
    updateActiveSessionPlans,
    handleCreateSession,
    handleSwitchSession,
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
