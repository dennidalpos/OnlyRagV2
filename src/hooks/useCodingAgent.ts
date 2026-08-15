import { useState, useEffect, useRef, useCallback } from 'react'
import { WorkspaceFile, AgentActionLog, AppSettings, IngestedDocument, CodingSession, WorkspaceProject } from '../types'
import { AgentMode } from '../components/coding/CodingAgentView'
import { useIngestedDocuments } from './useIngestedDocuments'
import { logger } from '../lib/logger'

export interface QueuedPrompt {
  id: string
  prompt: string
  createdAt: string
}

const SESSIONS_STORAGE_KEY = 'onlyrag_coding_sessions_v2'
const LAST_WORKSPACE_STORAGE_KEY = 'onlyrag_last_workspace'
const PROJECTS_STORAGE_KEY = 'onlyrag_workspace_projects'

function loadSavedProjects(): WorkspaceProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch (err: any) {
    logger.warn('useCodingAgent', `Could not parse saved projects: ${err?.message}`)
  }
  return []
}

function saveSavedProjects(projects: WorkspaceProject[]) {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects))
  } catch (err: any) {
    logger.warn('useCodingAgent', `Could not save projects: ${err?.message}`)
  }
}

function loadSavedSessions(): CodingSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch (err: any) {
    logger.warn('useCodingAgent', `Could not parse saved sessions from localStorage: ${err?.message}`)
  }
  return []
}

function saveSavedSessions(sessions: CodingSession[]) {
  try {
    const valid = sessions.filter(
      (s) => (s.actionLogs && s.actionLogs.length > 0) || (s.promptQueue && s.promptQueue.length > 0)
    )
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(valid))
  } catch (err: any) {
    logger.warn('useCodingAgent', `Could not persist sessions to localStorage: ${err?.message}`)
  }
}

export function useCodingAgent(settings?: AppSettings) {
  const [agentMode, setAgentMode] = useState<AgentMode>('plan')
  const [activeTab, setActiveTab] = useState<'editor' | 'terminal' | 'git_diff' | 'grep_search' | 'activities' | 'plan'>('editor')
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)

  // Workspace & Projects State
  const [projects, setProjects] = useState<WorkspaceProject[]>(() => loadSavedProjects())
  const [workspacePath, setWorkspacePath] = useState<string | null>(() => {
    return settings?.customWorkspacePath || localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY) || null
  })
  const [isStandaloneMode, setIsStandaloneMode] = useState<boolean>(settings?.noWorkspaceMode || false)

  // Sessions State
  const [allSessions, setAllSessions] = useState<CodingSession[]>(() => loadSavedSessions())
  const [activeSessionId, setActiveSessionId] = useState<string>('')

  // Prompt Queue State
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([])
  const promptQueueRef = useRef<QueuedPrompt[]>([])
  useEffect(() => {
    promptQueueRef.current = promptQueue
  }, [promptQueue])

  // Git Status & Diff State
  const [gitStatusLines, setGitStatusLines] = useState<string[]>([])
  const [gitDiffText, setGitDiffText] = useState<string>('')
  const [isFetchingGit, setIsFetchingGit] = useState<boolean>(false)

  // Guest OS Diagnostics State
  const [guestOsInfo, setGuestOsInfo] = useState<any>(null)
  const [isInspectingOs, setIsInspectingOs] = useState<boolean>(false)

  // Grep Search State
  const [grepQuery, setGrepQuery] = useState<string>('')
  const [grepIsRegex, setGrepIsRegex] = useState<boolean>(false)
  const [grepCaseInsensitive, setGrepCaseInsensitive] = useState<boolean>(true)
  const [grepResults, setGrepResults] = useState<any[]>([])
  const [isSearchingGrep, setIsSearchingGrep] = useState<boolean>(false)

  // File Tree State
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [openFiles, setOpenFiles] = useState<WorkspaceFile[]>([])
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [editorContent, setEditorContent] = useState<string>('// Select a workspace file on the left to edit and inspect code.')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [isSaved, setIsSaved] = useState<boolean>(true)

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

  // Terminal State
  const [terminalInput, setTerminalInput] = useState<string>('')
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    'Windows PowerShell v7.4.1 (UTF-8)',
    'OnlyRag V2 AI Coding Agent Terminal Ready.',
    'Type command or ask AI Agent to run PowerShell tasks.',
    '',
  ])

  // Pinned Files State
  const [pinnedFiles, setPinnedFiles] = useState<Map<string, WorkspaceFile>>(new Map())

  // Agent Execution State
  const [agentPrompt, setAgentPrompt] = useState<string>('')
  const [actionLogs, setActionLogs] = useState<AgentActionLog[]>([])
  const [isExecuting, setIsExecuting] = useState<boolean>(false)
  const [activeSkills, setActiveSkills] = useState<string[]>([])
  const [streamingText, setStreamingText] = useState<string>('')
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [maxSteps, setMaxSteps] = useState<number | string>(50)

  // Pending Approval State
  const [pendingApproval, setPendingApproval] = useState<{
    type: 'write_file' | 'replace_chunk' | 'multi_replace' | 'delete_file' | 'download_file' | 'terminal_cmd'
    target: string
    contentOrCmd: string
    replacement?: string
    replacements?: { targetContent: string; replacementContent: string }[]
    parameters?: Record<string, any>
  } | null>(null)

  // Initialize or restore session for active workspace
  useEffect(() => {
    const currentWorkspaceSessions = allSessions.filter(
      (s) => (s.workspacePath || '') === (workspacePath || '')
    )
    if (currentWorkspaceSessions.length === 0) {
      const newSession: CodingSession = {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workspacePath,
        title: 'Nuova Sessione',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actionLogs: [],
        promptQueue: [],
      }
      setAllSessions((prev) => {
        const next = [newSession, ...prev]
        saveSavedSessions(next)
        return next
      })
      setActiveSessionId(newSession.id)
      setActionLogs([])
      setPromptQueue([])
    } else {
      const active = currentWorkspaceSessions.find((s) => s.id === activeSessionId) || currentWorkspaceSessions[0]
      setActiveSessionId(active.id)
      setActionLogs(active.actionLogs || [])
      setPromptQueue(active.promptQueue || [])
    }
  }, [workspacePath])

  // Sync actionLogs and promptQueue changes to active session in storage
  useEffect(() => {
    if (!activeSessionId) return
    setAllSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            actionLogs,
            promptQueue,
            updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }
        }
        return s
      })
      saveSavedSessions(next)
      return next
    })
  }, [actionLogs, promptQueue, activeSessionId])

  const addActionLog = (type: AgentActionLog['type'], message: string, detail?: string) => {
    setActionLogs((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type,
        message,
        detail,
      },
    ])
  }

  const loadGuestOsInfo = async () => {
    if (window.electronAPI?.inspectGuestOsEnvironment) {
      setIsInspectingOs(true)
      try {
        const info = await window.electronAPI.inspectGuestOsEnvironment()
        setGuestOsInfo(info)
      } catch (err) {
        console.error('Failed inspecting guest OS:', err)
      } finally {
        setIsInspectingOs(false)
      }
    }
  }

  const handleRunGrepSearch = async () => {
    if (!grepQuery.trim() || !workspacePath || isStandaloneMode || !window.electronAPI?.grepWorkspaceFiles) return
    setIsSearchingGrep(true)
    try {
      const matches = await window.electronAPI.grepWorkspaceFiles(workspacePath, grepQuery, grepIsRegex, grepCaseInsensitive)
      setGrepResults(matches)
    } catch (err: any) {
      console.error('Grep search failed:', err)
    } finally {
      setIsSearchingGrep(false)
    }
  }

  const handleOpenFile = async (file: WorkspaceFile) => {
    if (file.isDir) return
    setSelectedFile(file)
    setActiveTab('editor')
    setOpenFiles((prev) => {
      if (prev.some((f) => f.path === file.path)) return prev
      return [...prev, file]
    })
    if (window.electronAPI) {
      try {
        const res = await window.electronAPI.readWorkspaceFile(file.path)
        if (res.success && res.content !== undefined) {
          setEditorContent(res.content)
          setOriginalContent(res.content)
          setIsSaved(true)
        } else if (res.error) {
          setEditorContent(`// Errore durante la lettura del file: ${res.error}`)
          setOriginalContent('')
        }
      } catch (err: any) {
        setEditorContent(`// Errore lettura file: ${err.message}`)
        setOriginalContent('')
      }
    }
  }

  const handleCloseFile = (fileToClose: WorkspaceFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== fileToClose.path)
      if (selectedFile?.path === fileToClose.path) {
        if (next.length > 0) {
          const fallback = next[next.length - 1]
          handleOpenFile(fallback)
        } else {
          setSelectedFile(null)
          setEditorContent('')
          setOriginalContent('')
        }
      }
      return next
    })
  }

  const loadWorkspaceFiles = async (targetPath?: string | null) => {
    if (isStandaloneMode || !targetPath) {
      setFiles([])
      setOpenFiles([])
      setSelectedFile(null)
      return
    }
    if (window.electronAPI) {
      try {
        const fileList = await window.electronAPI.listWorkspaceFiles(targetPath)
        setFiles(fileList)
      } catch (err) {
        console.error('Error loading workspace files:', err)
      }
    }
  }

  useEffect(() => {
    loadGuestOsInfo()
  }, [])

  useEffect(() => {
    loadWorkspaceFiles(workspacePath)
  }, [workspacePath, isStandaloneMode])

  const fetchGitStatusAndDiff = async () => {
    if (!window.electronAPI) return
    setIsFetchingGit(true)
    try {
      const res = await window.electronAPI.executePowerShellCommand(
        'git status --short; Write-Host "---GIT_DIFF_SPLIT---"; git diff -U3',
        workspacePath || undefined
      )
      const output = res.output || ''
      const parts = output.split('---GIT_DIFF_SPLIT---')
      const statusRaw = (parts[0] || '').trim()
      const diffRaw = (parts[1] || '').trim()

      setGitStatusLines(statusRaw ? statusRaw.split('\n') : ['No modified files detected in Git working tree.'])
      setGitDiffText(diffRaw || 'No uncommitted changes in Git working tree.')
    } catch (err: any) {
      setGitStatusLines(['Git command failed or not a Git repository.'])
      setGitDiffText(`Git error: ${err.message}`)
    } finally {
      setIsFetchingGit(false)
    }
  }

  const handleSelectProject = useCallback((pathStr: string) => {
    setWorkspacePath(pathStr)
    try {
      localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, pathStr)
    } catch (err: any) {
      logger.warn('useCodingAgent', `Failed saving last workspace: ${err?.message}`)
    }
    setProjects((prev) => {
      const folderName = pathStr.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
      const existing = prev.filter((p) => p.path !== pathStr)
      const updated: WorkspaceProject[] = [
        { path: pathStr, name: folderName, addedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() },
        ...existing,
      ]
      saveSavedProjects(updated)
      return updated
    })
    setIsStandaloneMode(false)
    setSelectedFile(null)
    loadWorkspaceFiles(pathStr)
  }, [loadWorkspaceFiles])

  const handleAddProject = useCallback(async () => {
    if (!window.electronAPI?.openDirectoryDialog) return
    const chosen = await window.electronAPI.openDirectoryDialog({ title: 'Aggiungi Cartella Progetto per Coding Agent Studio' })
    if (chosen) {
      handleSelectProject(chosen)
    }
  }, [handleSelectProject])

  const handleRemoveProject = useCallback((pathStr: string) => {
    setProjects((prev) => {
      const updated = prev.filter((p) => p.path !== pathStr)
      saveSavedProjects(updated)

      if (pathStr === workspacePath) {
        if (updated.length > 0) {
          handleSelectProject(updated[0].path)
        } else {
          setWorkspacePath(null)
          try {
            localStorage.removeItem(LAST_WORKSPACE_STORAGE_KEY)
          } catch (err: any) {
            logger.warn('useCodingAgent', `Could not clear last workspace: ${err?.message}`)
          }
          setFiles([])
          setOpenFiles([])
          setSelectedFile(null)
          setEditorContent('')
          setPinnedFiles(new Map())
        }
      }

      return updated
    })
  }, [workspacePath, handleSelectProject])

  const handleSelectWorkspaceFolder = async () => {
    await handleAddProject()
  }

  const handleToggleStandalone = () => {
    setIsStandaloneMode(!isStandaloneMode)
    if (!isStandaloneMode) {
      setSelectedFile(null)
      setFiles([])
    } else if (workspacePath) {
      loadWorkspaceFiles(workspacePath)
    }
  }

  const toggleAttachDoc = (docId: string) => {
    setAttachedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  const handleTogglePinFile = (file: WorkspaceFile) => {
    if (file.isDir) return
    setPinnedFiles((prev) => {
      const next = new Map(prev)
      if (next.has(file.path)) {
        next.delete(file.path)
        addActionLog('info', `Unpinned referenced file: ${file.name}`)
      } else {
        next.set(file.path, file)
        addActionLog('info', `Pinned referenced file to chat context: ${file.name}`)
      }
      return next
    })
  }

  const handleSaveFile = async () => {
    if (!selectedFile || !window.electronAPI) return
    const res = await window.electronAPI.writeWorkspaceFile(selectedFile.path, editorContent)
    if (res.success) {
      setOriginalContent(editorContent)
      setIsSaved(true)
      addActionLog('info', `Saved changes to ${selectedFile.name}`)
    }
  }

  const handleRunTerminalCommand = async (cmdToRun?: string, timeoutMs: number = 120000) => {
    const cmd = cmdToRun || terminalInput
    if (!cmd.trim() || !window.electronAPI) return

    setTerminalLogs((prev) => [...prev, `PS> ${cmd} (Executing... timeout: ${timeoutMs / 1000}s)`].slice(-500))
    if (!cmdToRun) setTerminalInput('')

    const res = await window.electronAPI.executePowerShellCommand(cmd, workspacePath || undefined, timeoutMs)
    const outStr = res.output || ''
    setTerminalLogs((prev) => [...prev, outStr, ''].slice(-500))

    if (!res.success || outStr.includes('non è stato possibile trovare') || outStr.includes('is not recognized') || outStr.includes('CommandNotFoundException')) {
      addActionLog(
        'terminal',
        `Command execution notice for "${cmd}":`,
        `Command output indicates tool or executable is not installed on Windows PATH or exited with error.\n${outStr.slice(0, 300)}`
      )
    }

    return res
  }

  useEffect(() => {
    if (!window.electronAPI) return

    const unsubLog = window.electronAPI.onAgentLog?.((log: AgentActionLog) => {
      setStreamingText('')
      setActionLogs((prev) => {
        const filtered = prev.filter((l) => l.id !== log.id)
        return [...filtered, log].slice(-500)
      })

      // Real-time synchronization of Right Window tabs
      // 1. If executing a terminal command -> switch to terminal tab and append output
      if (log.type === 'terminal' || log.message.includes('run_command') || log.message.startsWith('Ran ') || log.message.includes('Executing terminal command')) {
        setActiveTab('terminal')
        if (log.message) {
          setTerminalLogs((prev) => {
            const entry = log.detail ? `${log.message}\n${log.detail}` : log.message
            return [...prev, entry].slice(-500)
          })
        }
      }

      // 2. Refresh workspace files on file write/replace/delete operations without opening unwanted tabs
      if (
        log.message.includes('Successfully wrote file') ||
        log.message.includes('Successfully replaced') ||
        log.message.includes('Successfully deleted')
      ) {
        if (workspacePath) {
          loadWorkspaceFiles(workspacePath)
        }
      }
    })

    const unsubStreamToken = window.electronAPI.onAgentStreamToken?.((data: { step: number; chunk: string }) => {
      if (!data?.chunk) return
      setStreamingText((prev) => prev + data.chunk)
    })

    const unsubStep = window.electronAPI.onAgentStepUpdate?.((data: { step: number; maxSteps: number; maxStepsLabel: string }) => {
      if (data?.step !== undefined) setCurrentStep(data.step)
      if (data?.maxStepsLabel !== undefined) setMaxSteps(data.maxStepsLabel)
      else if (data?.maxSteps !== undefined) setMaxSteps(data.maxSteps)
    })

    const unsubApproval = window.electronAPI.onAgentApprovalRequest?.((req: any) => {
      setPendingApproval(req)
    })

    const unsubSkills = window.electronAPI.onAgentSkillsMatched?.((data: { skills: string[] }) => {
      setActiveSkills(data.skills || [])
    })

    const unsubDone = window.electronAPI.onAgentDone?.(() => {
      setIsExecuting(false)
      setStreamingText('')
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
      unsubStreamToken?.()
      unsubStep?.()
      unsubApproval?.()
      unsubSkills?.()
      unsubDone?.()
    }
  }, [])

  const handleCancelAgent = () => {
    setIsExecuting(false)
    if (window.electronAPI) {
      if (window.electronAPI.cancelAgentTask) window.electronAPI.cancelAgentTask()
      if (window.electronAPI.cancelOllamaStream) window.electronAPI.cancelOllamaStream()
    }
    addActionLog('info', 'Esecuzione interrotta dall\'utente.')
  }

  const workspaceSessions = allSessions.filter(
    (s) => (s.workspacePath || '') === (workspacePath || '')
  )
  const activeSession = allSessions.find((s) => s.id === activeSessionId) || workspaceSessions[0] || null

  const handleCreateSession = () => {
    if (isExecuting && window.electronAPI) {
      if (window.electronAPI.cancelAgentTask) window.electronAPI.cancelAgentTask()
      if (window.electronAPI.cancelOllamaStream) window.electronAPI.cancelOllamaStream()
    }
    const newSession: CodingSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workspacePath,
      title: 'Nuova Sessione',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actionLogs: [],
      promptQueue: [],
    }
    setAllSessions((prev) => {
      const next = [newSession, ...prev]
      saveSavedSessions(next)
      return next
    })
    setActiveSessionId(newSession.id)
    setIsExecuting(false)
    setAgentPrompt('')
    setActiveSkills([])
    setPromptQueue([])
    promptQueueRef.current = []
    setAttachedDocIds(new Set())
    setPinnedFiles(new Map())
    setPendingApproval(null)
    setActionLogs([])
  }

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId === activeSessionId) return
    if (isExecuting && window.electronAPI) {
      if (window.electronAPI.cancelAgentTask) window.electronAPI.cancelAgentTask()
      if (window.electronAPI.cancelOllamaStream) window.electronAPI.cancelOllamaStream()
    }
    const target = allSessions.find((s) => s.id === sessionId)
    if (target) {
      setActiveSessionId(target.id)
      setActionLogs(target.actionLogs || [])
      setPromptQueue(target.promptQueue || [])
      promptQueueRef.current = target.promptQueue || []
      setIsExecuting(false)
      setAgentPrompt('')
    }
  }

  const handleDeleteSession = (sessionId: string) => {
    const remaining = allSessions.filter((s) => s.id !== sessionId)
    setAllSessions(remaining)
    saveSavedSessions(remaining)

    if (window.electronAPI?.deleteAgentSession) {
      window.electronAPI.deleteAgentSession(sessionId, workspacePath)
    }

    if (remaining.length === 0 && window.electronAPI?.clearCodingAgentAuditLog) {
      window.electronAPI.clearCodingAgentAuditLog()
    }

    if (activeSessionId === sessionId) {
      const nextInWorkspace = remaining.filter((s) => (s.workspacePath || '') === (workspacePath || ''))
      if (nextInWorkspace.length > 0) {
        handleSwitchSession(nextInWorkspace[0].id)
      } else {
        handleCreateSession()
      }
    }
  }

  const handleRenameSession = (sessionId: string, newTitle: string) => {
    if (!newTitle.trim()) return
    setAllSessions((prev) => {
      const next = prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle.trim() } : s))
      saveSavedSessions(next)
      return next
    })
  }

  const handleNewSession = handleCreateSession

  const executeTask = async (taskPrompt: string) => {
    if (!taskPrompt.trim() || !window.electronAPI) return
    setIsExecuting(true)
    setActiveSkills([])
    addActionLog('info', `User Prompt: ${taskPrompt}`)

    // Auto-update session title if it is default
    if (activeSession && (activeSession.title === 'Nuova Sessione' || activeSession.title === 'New Session' || activeSession.title.startsWith('Session '))) {
      const autoTitle = taskPrompt.slice(0, 32).trim() + (taskPrompt.length > 32 ? '...' : '')
      handleRenameSession(activeSession.id, autoTitle)
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

      await window.electronAPI.startAgentTask({
        sessionId: activeSessionId || activeSession?.id,
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
    } catch (err: any) {
      addActionLog('info', `Agent Execution Error: ${err.message}`)
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
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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

  const handleApproveAction = async () => {
    if (!pendingApproval) return
    const current = pendingApproval
    setPendingApproval(null)
    setIsExecuting(true)

    if (current.type === 'terminal_cmd') {
      addActionLog('terminal', `User approved terminal command: ${current.contentOrCmd}`)
      await handleRunTerminalCommand(current.contentOrCmd)
    } else if (current.type === 'replace_chunk' && current.replacement && window.electronAPI) {
      addActionLog('tool_call', `User approved chunk replacement in: ${current.target}`)
      await window.electronAPI.replaceWorkspaceFileChunk(current.target, current.contentOrCmd, current.replacement)
      if (selectedFile && selectedFile.path === current.target) {
        handleOpenFile(selectedFile)
      }
    } else if (current.type === 'multi_replace' && current.replacements && window.electronAPI) {
      addActionLog('tool_call', `User approved multi-chunk replacement in: ${current.target}`)
      await window.electronAPI.multiReplaceWorkspaceFileChunks(current.target, current.replacements)
      if (selectedFile && selectedFile.path === current.target) {
        handleOpenFile(selectedFile)
      }
    } else if (current.type === 'delete_file' && window.electronAPI) {
      addActionLog('tool_call', `User approved file deletion: ${current.target}`)
      await window.electronAPI.deleteWorkspaceFile(current.target)
      if (workspacePath) loadWorkspaceFiles(workspacePath)
    } else if (current.type === 'download_file' && window.electronAPI) {
      addActionLog('tool_call', `User approved file download from ${current.contentOrCmd} to ${current.target}`)
      const dlRes = await window.electronAPI.downloadFile(current.contentOrCmd, current.target)
      if (dlRes.success) {
        addActionLog('info', `Downloaded ${dlRes.downloadedBytes} bytes to ${current.target}`)
        if (workspacePath) loadWorkspaceFiles(workspacePath)
      } else {
        addActionLog('info', `Download failed: ${dlRes.error}`)
      }
    } else if (current.type === 'write_file' && window.electronAPI) {
      addActionLog('tool_call', `User approved file write to: ${current.target}`)
      await window.electronAPI.writeWorkspaceFile(current.target, current.contentOrCmd)
      if (selectedFile && selectedFile.path === current.target) {
        handleOpenFile(selectedFile)
      }
    }
    setIsExecuting(false)
  }

  const compactContext = useCallback(() => {
    if (actionLogs.length === 0) return
    const recentLogs = actionLogs.slice(-6)
    const summaryLog: AgentActionLog = {
      id: `compacted-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
    handleClearTerminal: () => setTerminalLogs(['Windows PowerShell (Terminal Svuotato)', '']),
    handleAgentExecute,
    handleCancelAgent,
    allSessions,
    workspaceSessions,
    activeSessionId,
    activeSession,
    handleCreateSession,
    handleSwitchSession,
    handleDeleteSession,
    handleRenameSession,
    handleNewSession,
    handleApproveAction,
    compactContext,
    addActionLog,
  }
}
