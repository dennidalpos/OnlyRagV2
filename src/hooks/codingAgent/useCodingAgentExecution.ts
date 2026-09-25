import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeAgentStepBudget } from '../../../shared/domain/agent/agentStepBudget'
import type {
  AgentActionLog,
  AgentCapabilityProfile,
  AgentChangeMetrics,
  AgentCompletionEvidence,
  AgentCompletionStatus,
  AgentContextBudgetBreakdown,
  AgentDoneResult,
  AgentMode,
  AgentPlan,
  AgentRunIdentity,
  AppSettings,
  CodingSession,
  ExecutedPromptOutcome,
  IngestedDocument,
  WorkspaceFile,
} from '../../types'
import { useAgentApprovals } from '../useAgentApprovals'
import { useAgentPromptQueue } from '../useAgentPromptQueue'
import type { useSessionHistory } from '../useSessionHistory'
import { acquireGlobalTaskLock, peekGlobalTaskLock, releaseGlobalTaskLock } from '../../services/globalTaskLock'
import { soundEffectsService } from '../../services/soundEffectsService'
import { logger } from '../../lib/logger'
import { normalizeError } from '../../lib/errors/errorNormalizer'
import { createAgentRunIdentity, matchesAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'
import { resolveAgentCapabilityProfile } from '../../../shared/domain/agent/agentCapabilityProfile'
import type { AgentActionLogApi } from './useAgentActionLog'
import { loadDocumentMarkdown } from '../../services/documentMarkdown'
import { resolveConfiguredModel } from '../../../shared/domain/settings/configuredModel'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { useTranslation } from '../../i18n'

const EMPTY_CHANGE_METRICS: AgentChangeMetrics = { filesTouched: 0, additions: 0, deletions: 0 }
const FILE_MUTATION_APPROVAL_TYPES = new Set(['write_file', 'replace_chunk', 'multi_replace', 'delete_file'])

type SessionHistoryApi = ReturnType<typeof useSessionHistory>

export interface UseCodingAgentExecutionOptions {
  settings?: AppSettings
  workspacePath: string | null
  isStandaloneMode: boolean
  actionLog: AgentActionLogApi
  session: Pick<SessionHistoryApi, 'activeSessionId' | 'activeSession' | 'beginExecutedPrompt' | 'completeExecutedPrompt'> & {
    updateActiveSessionPlans: (updater: (prev: AgentPlan[]) => AgentPlan[]) => void
  }
  editor: {
    selectedFile: WorkspaceFile | null
    editorContent: string
    loadedContentHash?: string
    handleOpenFile: (file: WorkspaceFile) => Promise<void>
  }
  context: {
    ingestedDocs: IngestedDocument[]
    attachedDocIds: Set<string>
    pinnedFiles: Map<string, WorkspaceFile>
  }
  appendTerminalLogs: (text: string) => void
}

/**
 * One agent run at a time: mode and capability profile, the Main IPC event stream bound to the active run
 * identity, the prompt queue, approvals, and the executed-prompt record of the active session.
 */
export function useCodingAgentExecution({
  settings,
  workspacePath,
  isStandaloneMode,
  actionLog,
  session,
  editor,
  context,
  appendTerminalLogs,
}: UseCodingAgentExecutionOptions) {
  const { t } = useTranslation()
  const { actionLogs, setActionLogs, addActionLog } = actionLog
  const [agentMode, setAgentMode] = useState<AgentMode>('guided')
  const [capabilityProfile, setCapabilityProfile] = useState<AgentCapabilityProfile>(() => resolveAgentCapabilityProfile(settings))
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false)
  const [agentPrompt, setAgentPrompt] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [activeRunIdentity, setActiveRunIdentity] = useState<Readonly<AgentRunIdentity> | null>(null)
  const activeRunIdentityRef = useRef<Readonly<AgentRunIdentity> | null>(null)
  const [activeSkills, setActiveSkills] = useState<string[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [currentStatusText, setCurrentStatusText] = useState('')
  const [currentStep, setCurrentStep] = useState(0)
  const [maxSteps, setMaxSteps] = useState<number | string>(() => {
    const budget = normalizeAgentStepBudget(settings?.maxToolCallSteps)
    return budget === 0 ? '∞' : budget
  })
  const [changeMetrics, setChangeMetrics] = useState<AgentChangeMetrics>(EMPTY_CHANGE_METRICS)
  const [currentLiveModel, setCurrentLiveModel] = useState<string | null>(null)
  const [contextBudget, setContextBudget] = useState<AgentContextBudgetBreakdown | null>(null)
  const [forceContextCompaction, setForceContextCompaction] = useState(false)

  const runningExecutedPromptRef = useRef<{ sessionId: string; promptId: string } | null>(null)
  const currentStepRef = useRef(0)
  const changeMetricsRef = useRef<AgentChangeMetrics>(EMPTY_CHANGE_METRICS)

  const { pendingApproval, setPendingApproval, clearPendingApproval } = useAgentApprovals()
  const handleQueueNotice = useCallback((msg: string) => addActionLog('info', msg), [addActionLog])
  const { promptQueue, addToPromptQueue, removeFromPromptQueue, editPromptInQueue, dequeueNextPrompt, clearPromptQueue, setPromptQueue } =
    useAgentPromptQueue(handleQueueNotice)

  const updateActiveRunIdentity = useCallback((identity: Readonly<AgentRunIdentity> | null) => {
    activeRunIdentityRef.current = identity
    setActiveRunIdentity(identity)
  }, [])

  useEffect(() => {
    if (!isExecuting) setCapabilityProfile(resolveAgentCapabilityProfile(settings))
  }, [isExecuting, settings])

  useEffect(() => {
    if (!isExecuting) return
    acquireGlobalTaskLock('coding')
    return () => releaseGlobalTaskLock('coding')
  }, [isExecuting])

  useEffect(() => {
    if (!isExecuting) {
      const budget = normalizeAgentStepBudget(settings?.maxToolCallSteps)
      setMaxSteps(budget === 0 ? '∞' : budget)
    }
  }, [settings?.maxToolCallSteps, isExecuting])

  useEffect(() => {
    setChangeMetrics(EMPTY_CHANGE_METRICS)
    setStreamingText('')
    clearPendingApproval()
    setCurrentStep(0)
  }, [workspacePath, clearPendingApproval])

  const completeExecutedPromptRef = useRef(session.completeExecutedPrompt)
  useEffect(() => {
    completeExecutedPromptRef.current = session.completeExecutedPrompt
  }, [session.completeExecutedPrompt])

  const closeRunningExecutedPrompt = useCallback(
    (outcome: ExecutedPromptOutcome, summary?: string, completionStatus?: AgentCompletionStatus, evidence?: AgentCompletionEvidence) => {
      const running = runningExecutedPromptRef.current
      if (!running) return
      runningExecutedPromptRef.current = null
      completeExecutedPromptRef.current(running.sessionId, running.promptId, {
        outcome,
        totalSteps: currentStepRef.current,
        metrics: changeMetricsRef.current,
        summary,
        completionStatus,
        evidence,
      })
    },
    [],
  )

  const executeTask = async (taskPrompt: string, overrideMode?: AgentMode, planRevisionId?: string, runProfile: AgentCapabilityProfile = capabilityProfile) => {
    if (!taskPrompt.trim() || !window.electronAPI) return

    const busyModule = peekGlobalTaskLock()
    if (busyModule && busyModule !== 'coding') {
      const busyModuleName = t(busyModule === 'ingestion' ? 'common.moduleNameIngestion' : 'common.moduleNameTranslation')
      addActionLog('info', t('common.crossModuleTaskBlocked', { module: busyModuleName }))
      return
    }

    setIsExecuting(true)
    setActiveSkills([])
    setChangeMetrics(EMPTY_CHANGE_METRICS)
    changeMetricsRef.current = EMPTY_CHANGE_METRICS
    currentStepRef.current = 0
    addActionLog('info', `User Prompt: ${taskPrompt}`, undefined, { category: 'user_prompt' })

    const effectiveMode = overrideMode || agentMode
    const runSessionId = session.activeSessionId || session.activeSession?.id || ''
    if (!runSessionId) {
      setIsExecuting(false)
      addActionLog('info', t('agentRun.noActiveConversation'))
      return
    }
    const identity = createAgentRunIdentity({
      conversationId: runSessionId,
      planRevisionId,
      workspacePath,
    })
    updateActiveRunIdentity(identity)
    runningExecutedPromptRef.current = {
      sessionId: runSessionId,
      promptId: session.beginExecutedPrompt(runSessionId, taskPrompt, effectiveMode),
    }

    try {
      const { selectedFile, editorContent, loadedContentHash } = editor
      // '' when none is configured: the Main preflight blocks the run and says so.
      const activeModel = resolveConfiguredModel('coding', settings)
      const activeFile =
        selectedFile && loadedContentHash ? { name: selectedFile.name, path: selectedFile.path, content: editorContent, versionHash: loadedContentHash } : null

      // The document list carries metadata only; attached documents are loaded on demand.
      const attachedDocs = await Promise.all(
        context.ingestedDocs
          .filter((d) => context.attachedDocIds.has(d.id))
          .map(async (d) => ({
            id: d.id,
            filename: d.filename,
            extractedMarkdown: (await loadDocumentMarkdown(d)) ?? '',
          })),
      )

      const resolvedPinnedFiles = await Promise.all(
        Array.from(context.pinnedFiles.values()).map(async (f) => {
          let content = selectedFile && selectedFile.path === f.path ? editorContent : ''
          if (!content && window.electronAPI?.readWorkspaceFile) {
            try {
              const res = await window.electronAPI.readWorkspaceFile({ filePath: f.path })
              if (res.success && res.content) {
                content = res.content
              }
            } catch (err: unknown) {
              logger.warn('useCodingAgent', `Error reading pinned file ${f.path}: ${errorMessage(err)}`)
            }
          }
          return { name: f.name, path: f.path, content }
        }),
      )

      const initialLog = actionLogs.find((l) => l.message.startsWith('User Prompt: '))
      const initialUserTask = initialLog ? initialLog.message.replace(/^User Prompt:\s*/, '') : taskPrompt

      const res = await window.electronAPI.startAgentTask({
        identity,
        sessionId: runSessionId,
        userTask: taskPrompt,
        initialUserTask,
        agentMode: effectiveMode,
        workspacePath,
        isStandaloneMode,
        activeModel,
        activeFile,
        pinnedFiles: resolvedPinnedFiles,
        attachedDocs,
        capabilityProfile: resolveAgentCapabilityProfile(runProfile),
        forceContextCompaction,
        settings,
      })

      if (!res?.success) {
        if (matchesAgentRunIdentity(activeRunIdentityRef.current, identity)) updateActiveRunIdentity(null)
        const normalized = normalizeError(res?.error || t('agentRun.unknownError'), 'Coding Agent')
        closeRunningExecutedPrompt('failed', normalized.message)
        setIsExecuting(false)
        addActionLog('info', t('agentRun.startFailed', { message: `${normalized.message}${normalized.remediation ? ` — ${normalized.remediation}` : ''}` }))
      } else if (res.runId !== identity.runId) {
        if (matchesAgentRunIdentity(activeRunIdentityRef.current, identity)) updateActiveRunIdentity(null)
        closeRunningExecutedPrompt('failed', t('agentRun.identityMismatchPrompt'))
        setIsExecuting(false)
        addActionLog('info', t('agentRun.identityMismatchLog'))
      } else if ((res.queuePosition || 0) > 0) {
        addActionLog('info', t('agentRun.queued', { runId: res.runId, position: res.queuePosition || 0 }))
      }
    } catch (err: unknown) {
      if (matchesAgentRunIdentity(activeRunIdentityRef.current, identity)) updateActiveRunIdentity(null)
      const normalized = normalizeError(err, 'Coding Agent')
      closeRunningExecutedPrompt('failed', normalized.message)
      setIsExecuting(false)
      addActionLog('info', t('agentRun.executionFailed', { message: `${normalized.message}${normalized.remediation ? ` — ${normalized.remediation}` : ''}` }))
    }
  }

  // The IPC subscription lives for the whole component; it reads the render-time state through these refs,
  // so an auto-dequeued prompt runs with the current mode, session, editor and attachments.
  const executeTaskRef = useRef(executeTask)
  const updateActiveSessionPlansRef = useRef(session.updateActiveSessionPlans)
  useEffect(() => {
    executeTaskRef.current = executeTask
    updateActiveSessionPlansRef.current = session.updateActiveSessionPlans
  })

  useEffect(() => {
    if (!window.electronAPI) return

    let streamBuffer = ''
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null
    let dequeueTimer: ReturnType<typeof setTimeout> | null = null

    const flushStreamBuffer = () => {
      if (streamBuffer) {
        const chunkToAdd = streamBuffer
        streamBuffer = ''
        setStreamingText((prev) => prev + chunkToAdd)
      }
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer)
        streamFlushTimer = null
      }
    }

    const clearStreamBuffer = () => {
      streamBuffer = ''
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer)
        streamFlushTimer = null
      }
    }

    const appendToStreamBuffer = (chunk: string) => {
      if (!chunk) return
      streamBuffer += chunk
      if (!streamFlushTimer) {
        streamFlushTimer = setTimeout(flushStreamBuffer, 40)
      }
    }

    const soundsEnabled = settings?.enableSoundEffects !== false

    const unsubLog = window.electronAPI.onAgentLog?.((log: AgentActionLog & AgentRunIdentity) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, log)) return
      setActionLogs((prev) => [...prev, log])

      if (log.modelName) {
        setCurrentLiveModel(log.modelName)
      } else if (typeof log.meta?.modelName === 'string') {
        setCurrentLiveModel(log.meta.modelName)
      }

      if (log.type === 'tool_call') {
        clearStreamBuffer()
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
          soundEffectsService.play('error', soundsEnabled)
        }
      }

      if (
        log.type === 'info' &&
        (log.detail?.includes('Circuit Breaker Triggered') || log.message.includes('LLM Stream error') || log.category === 'system_alert')
      ) {
        soundEffectsService.play('error', soundsEnabled)
      }
    })

    const unsubStreamToken = window.electronAPI.onAgentStreamToken?.((data) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, data)) return
      if (data.chunk) appendToStreamBuffer(data.chunk)
    })

    const unsubStreamThought = window.electronAPI.onAgentStreamThought?.((data) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, data)) return
      if (data.chunk) appendToStreamBuffer(data.chunk)
    })

    const unsubStep = window.electronAPI.onAgentStepUpdate?.((data) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, data)) return
      currentStepRef.current = data.step
      setCurrentStep(data.step)
      clearStreamBuffer()
      setStreamingText('')
      if (data?.statusText) {
        setCurrentStatusText(data.statusText)
      }
      if (data?.maxStepsLabel !== undefined) setMaxSteps(data.maxStepsLabel)
      else if (data?.maxSteps !== undefined) setMaxSteps(data.maxSteps)
      const milestones = data?.milestones
      if (milestones && milestones.length > 0) {
        updateActiveSessionPlansRef.current((prev) => {
          const revisionIndex = prev.findIndex((plan) => `${plan.id}:v${plan.version}` === data.planRevisionId)
          if (revisionIndex < 0) return prev
          const copy = [...prev]
          copy[revisionIndex] = { ...copy[revisionIndex], milestones: [...milestones] }
          return copy
        })
      }
    })

    const unsubContextBudget = window.electronAPI.onAgentContextBudget?.((data) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, data)) return
      setContextBudget(data)
    })

    const unsubApproval = window.electronAPI.onAgentApprovalRequest?.((req) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, req)) return
      setPendingApproval(req)
      if (req) {
        soundEffectsService.play('interactive', soundsEnabled)
      }
    })

    const unsubSkills = window.electronAPI.onAgentSkillsMatched?.((data) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, data)) return
      setActiveSkills(data.skills || [])
    })

    const unsubChangeMetrics = window.electronAPI.onAgentChangeMetrics?.((data) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, data)) return
      if (data) {
        changeMetricsRef.current = data
        setChangeMetrics(data)
      }
    })

    const unsubDone = window.electronAPI.onAgentDone?.((res: AgentDoneResult & AgentRunIdentity) => {
      if (!matchesAgentRunIdentity(activeRunIdentityRef.current, res)) return
      updateActiveRunIdentity(null)
      soundEffectsService.play(res?.success === false ? 'error' : 'completion', soundsEnabled)
      setCurrentLiveModel(null)
      const outcome = res?.completionStatus === 'cancelled' ? 'cancelled' : res?.success === false ? 'failed' : 'success'
      closeRunningExecutedPrompt(outcome, res?.summary, res?.completionStatus, res?.evidence)
      setIsExecuting(false)
      clearStreamBuffer()
      setStreamingText('')
      setCurrentStatusText('')

      const nextItem = res?.completionStatus === 'cancelled' ? undefined : dequeueNextPrompt()
      if (nextItem) {
        dequeueTimer = setTimeout(() => {
          dequeueTimer = null
          executeTaskRef.current(nextItem.prompt)
        }, 300)
      }
    })

    return () => {
      clearStreamBuffer()
      if (dequeueTimer) clearTimeout(dequeueTimer)
      unsubLog?.()
      unsubStreamToken?.()
      unsubStreamThought?.()
      unsubStep?.()
      unsubContextBudget?.()
      unsubApproval?.()
      unsubSkills?.()
      unsubChangeMetrics?.()
      unsubDone?.()
    }
  }, [
    appendTerminalLogs,
    closeRunningExecutedPrompt,
    dequeueNextPrompt,
    setActionLogs,
    setPendingApproval,
    settings?.enableSoundEffects,
    updateActiveRunIdentity,
  ])

  const handleCancelAgent = () => {
    const identity = activeRunIdentityRef.current
    setCurrentStatusText(t('agentRun.cancelling'))
    if (identity) window.electronAPI?.cancelAgentTask?.(identity)
    addActionLog('info', t('agentRun.cancelledByUser'))
  }

  const handleAgentExecute = async (overridePrompt?: string, overrideMode?: AgentMode, planRevisionId?: string, runProfile?: AgentCapabilityProfile) => {
    const text = typeof overridePrompt === 'string' ? overridePrompt : agentPrompt
    if (!text.trim()) return

    const isOverride = typeof overridePrompt === 'string'
    if (isExecuting) {
      addToPromptQueue(text)
      if (!isOverride) setAgentPrompt('')
      return
    }

    if (!isOverride) setAgentPrompt('')
    await executeTask(text, overrideMode, planRevisionId, runProfile)
  }

  const handleApproveAction = async (approvedHunkIndices?: number[]) => {
    if (!pendingApproval || !window.electronAPI?.respondToAgentApproval) return
    const current = pendingApproval
    clearPendingApproval()
    const partialNote = approvedHunkIndices ? ` (${approvedHunkIndices.length} hunk selezionati)` : ''
    addActionLog('tool_call', `User approved ${current.type}: ${current.target}${partialNote}`)
    await window.electronAPI.respondToAgentApproval({ identity: current, approved: true, approvedHunkIndices })
    const { selectedFile, handleOpenFile } = editor
    if (FILE_MUTATION_APPROVAL_TYPES.has(current.type) && selectedFile && selectedFile.path === current.target) {
      setTimeout(() => handleOpenFile(selectedFile), 400)
    }
  }

  const handleRejectAction = async () => {
    if (!pendingApproval) return
    const current = pendingApproval
    clearPendingApproval()
    addActionLog('info', `User rejected ${current.type}: ${current.target}`)
    await window.electronAPI?.respondToAgentApproval?.({ identity: current, approved: false })
  }

  const compactContext = useCallback(async () => {
    setForceContextCompaction(true)
    const identity = activeRunIdentityRef.current
    const appliedToActiveRun = identity && window.electronAPI?.compactAgentContext ? await window.electronAPI.compactAgentContext(identity) : false
    addActionLog(
      'info',
      appliedToActiveRun
        ? '🧹 Context compaction requested: Main will reduce the next model prompt; the audit timeline remains complete.'
        : '🧹 Context compaction enabled for the next run; the audit timeline remains complete.',
    )
  }, [addActionLog])

  /** Detaches the view from the running agent (cancelling it) and clears every run-scoped indicator. */
  const resetRunView = () => {
    const identity = activeRunIdentityRef.current
    updateActiveRunIdentity(null)
    if (isExecuting && identity) window.electronAPI?.cancelAgentTask?.(identity)
    runningExecutedPromptRef.current = null
    setIsExecuting(false)
    setAgentPrompt('')
    setActiveSkills([])
    setChangeMetrics(EMPTY_CHANGE_METRICS)
    setContextBudget(null)
    setForceContextCompaction(false)
    setStreamingText('')
    setCurrentStep(0)
    clearPendingApproval()
  }

  /** Drops the visible timeline and queued prompts of the active conversation. */
  const clearConversation = () => {
    setActionLogs([])
    clearPromptQueue()
  }

  /** Loads the persisted timeline, queue and context settings of the conversation that just became active. */
  const hydrateFromSession = useCallback(
    (activeSession: CodingSession | null | undefined) => {
      setActionLogs(activeSession?.actionLogs || [])
      setPromptQueue(activeSession?.promptQueue || [])
      setStreamingText('')
      clearPendingApproval()
      setCurrentStep(0)
      setContextBudget(activeSession?.contextBudget || null)
      setForceContextCompaction(Boolean(activeSession?.forceContextCompaction))
    },
    [clearPendingApproval, setActionLogs, setPromptQueue],
  )

  return {
    agentMode,
    setAgentMode,
    isPromptModalOpen,
    setIsPromptModalOpen,
    agentPrompt,
    setAgentPrompt,
    isExecuting,
    activeRunIdentity,
    currentLiveModel,
    currentStep,
    maxSteps,
    activeSkills,
    streamingText,
    currentStatusText,
    changeMetrics,
    contextBudget,
    forceContextCompaction,
    pendingApproval,
    promptQueue,
    removeFromPromptQueue,
    editPromptInQueue,
    handleAgentExecute,
    handleCancelAgent,
    handleApproveAction,
    handleRejectAction,
    compactContext,
    resetRunView,
    clearConversation,
    hydrateFromSession,
  }
}
