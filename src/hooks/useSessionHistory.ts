import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AgentActionLog,
  AgentChangeMetrics,
  AgentExecutionMode,
  AgentPlan,
  CodingSession,
  ExecutedPrompt,
  ExecutedPromptOutcome,
  QueuedPromptRecord,
} from '../types'
import { logger } from '../lib/logger'

const LEGACY_SESSIONS_STORAGE_KEY = 'onlyrag_coding_sessions_v2'
const MIGRATION_FLAG_KEY = 'onlyrag_sessions_migrated_to_filesystem_v1'

export interface ExecutedPromptResult {
  outcome: ExecutedPromptOutcome
  totalSteps: number
  metrics: AgentChangeMetrics
  summary?: string
}

/** An untouched session is not written to disk, so browsing workspaces leaves no empty records. */
function hasPersistableContent(session: CodingSession): boolean {
  return (
    session.executedPrompts.length > 0 ||
    session.actionLogs.length > 0 ||
    (session.promptQueue?.length ?? 0) > 0 ||
    (session.plans?.length ?? 0) > 0
  )
}

function createEmptySession(workspacePath: string | null): CodingSession {
  const nowIso = new Date().toISOString()
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workspacePath,
    title: 'Nuova Sessione',
    createdAt: nowIso,
    updatedAt: nowIso,
    actionLogs: [],
    executedPrompts: [],
    promptQueue: [],
  }
}

/**
 * One-shot import of the sessions previously kept in localStorage. Runs once per
 * installation: the legacy key is dropped only after the main process confirms the
 * import, so a failed migration is retried on the next launch instead of losing data.
 */
async function migrateLegacySessions(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'done') return
  const raw = localStorage.getItem(LEGACY_SESSIONS_STORAGE_KEY)
  if (!raw) {
    localStorage.setItem(MIGRATION_FLAG_KEY, 'done')
    return
  }
  if (!window.electronAPI?.migrateLegacyCodingSessions) return

  try {
    const parsed = JSON.parse(raw)
    const res = await window.electronAPI.migrateLegacyCodingSessions(parsed)
    localStorage.removeItem(LEGACY_SESSIONS_STORAGE_KEY)
    localStorage.setItem(MIGRATION_FLAG_KEY, 'done')
    logger.info('useSessionHistory', `Migrated ${res?.migrated ?? 0} legacy coding session(s) to the filesystem store.`)
  } catch (err: any) {
    logger.warn('useSessionHistory', `Legacy session migration failed, will retry on next launch: ${err?.message}`)
  }
}

/**
 * Owns the coding session history of the active workspace. The filesystem store behind
 * the `sessions:*` IPC channels is the single source of truth: this hook mirrors it in
 * memory and persists each meaningful change through a serialized IPC write.
 */
export function useSessionHistory(workspacePath: string | null) {
  const [sessions, setSessions] = useState<CodingSession[]>([])
  const sessionsRef = useRef<CodingSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(true)

  const persistenceChainsRef = useRef<Map<string, Promise<void>>>(new Map())
  /**
   * Bootstrap session created for an empty workspace store, kept per workspace so a
   * repeated load (React StrictMode double-invoke, or a workspace revisited before the
   * debounced write lands) reuses the same record instead of creating a duplicate.
   */
  const bootstrapSessionsRef = useRef<Map<string, CodingSession>>(new Map())

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const flushPendingWrites = useCallback(async () => {
    await Promise.all(Array.from(persistenceChainsRef.current.values()))
  }, [])

  const schedulePersist = useCallback(
    (session: CodingSession): Promise<CodingSession | null> => {
      const saveCodingSession = window.electronAPI?.saveCodingSession
      if (!hasPersistableContent(session) || !saveCodingSession) return Promise.resolve(null)

      const previous = persistenceChainsRef.current.get(session.id) || Promise.resolve()
      const save = previous.then(async () => {
        try {
          const saved = await saveCodingSession(session)
          if (saved && saved.title !== session.title) {
            const current = sessionsRef.current
            sessionsRef.current = current.map((item) => item.id === saved.id ? { ...item, title: saved.title } : item)
            setSessions(sessionsRef.current)
          }
          return saved
        } catch (err: any) {
          logger.warn('useSessionHistory', `Could not persist session ${session.id}: ${err?.message}`)
          return null
        }
      })
      persistenceChainsRef.current.set(session.id, save.then(() => undefined))
      return save
    },
    []
  )

  const mutateSession = useCallback(
    (sessionId: string, mutator: (session: CodingSession) => CodingSession) => {
      if (!sessionId) return
      const current = sessionsRef.current
      const session = current.find((item) => item.id === sessionId)
      if (!session) return
      const next = { ...mutator(session), updatedAt: new Date().toISOString() }
      sessionsRef.current = current.map((item) => item.id === sessionId ? next : item)
      setSessions(sessionsRef.current)
      void schedulePersist(next)
    },
    [schedulePersist]
  )

  // Loads the history of the active workspace, after the one-shot localStorage migration.
  useEffect(() => {
    let cancelled = false

    const loadSessions = async () => {
      setIsLoadingSessions(true)
      await flushPendingWrites()
      await migrateLegacySessions()

      let stored: CodingSession[] = []
      if (window.electronAPI?.listCodingSessions) {
        try {
          stored = (await window.electronAPI.listCodingSessions(workspacePath)) || []
        } catch (err: any) {
          logger.warn('useSessionHistory', `Could not load session history: ${err?.message}`)
        }
      }
      if (cancelled) return

      if (stored.length === 0) {
        const workspaceKey = workspacePath || ''
        const fresh = bootstrapSessionsRef.current.get(workspaceKey) || createEmptySession(workspacePath)
        bootstrapSessionsRef.current.set(workspaceKey, fresh)
        sessionsRef.current = [fresh]
        setSessions([fresh])
        setActiveSessionId(fresh.id)
        schedulePersist(fresh)
      } else {
        sessionsRef.current = stored
        setSessions(stored)
        setActiveSessionId(stored[0].id)
      }
      setIsLoadingSessions(false)
    }

    void loadSessions()
    return () => {
      cancelled = true
    }
  }, [workspacePath, flushPendingWrites, schedulePersist])

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null

  const createSession = useCallback((): CodingSession => {
    const fresh = createEmptySession(workspacePath)
    bootstrapSessionsRef.current.set(workspacePath || '', fresh)
    sessionsRef.current = [fresh, ...sessionsRef.current]
    setSessions(sessionsRef.current)
    setActiveSessionId(fresh.id)
    schedulePersist(fresh)
    return fresh
  }, [workspacePath, schedulePersist])

  const switchSession = useCallback(
    (sessionId: string): CodingSession | null => {
      const target = sessionsRef.current.find((s) => s.id === sessionId)
      if (!target) return null
      void flushPendingWrites()
      setActiveSessionId(target.id)
      return target
    },
    [flushPendingWrites]
  )

  /** Deletes a session and returns the session that became active, when it changed. */
  const deleteSession = useCallback(
    async (sessionId: string): Promise<CodingSession | null> => {
      await flushPendingWrites()
      if (window.electronAPI?.deleteCodingSession) {
        try {
          await window.electronAPI.deleteCodingSession(sessionId, workspacePath)
        } catch (err: any) {
          logger.warn('useSessionHistory', `Could not delete session ${sessionId}: ${err?.message}`)
        }
      }

      const remaining = sessionsRef.current.filter((s) => s.id !== sessionId)
      if (remaining.length === 0) {
        const fresh = createEmptySession(workspacePath)
        bootstrapSessionsRef.current.set(workspacePath || '', fresh)
        sessionsRef.current = [fresh]
        setSessions([fresh])
        setActiveSessionId(fresh.id)
        schedulePersist(fresh)
        return fresh
      }

      sessionsRef.current = remaining
      setSessions(remaining)
      if (sessionId === activeSessionId) {
        setActiveSessionId(remaining[0].id)
        return remaining[0]
      }
      return null
    },
    [activeSessionId, workspacePath, schedulePersist, flushPendingWrites]
  )

  /** Deletes the whole history of the active workspace and starts from a clean session. */
  const clearSessions = useCallback(async (): Promise<CodingSession> => {
    await flushPendingWrites()
    if (window.electronAPI?.clearCodingSessions) {
      try {
        await window.electronAPI.clearCodingSessions(workspacePath)
      } catch (err: any) {
        logger.warn('useSessionHistory', `Could not clear session history: ${err?.message}`)
      }
    }
    const fresh = createEmptySession(workspacePath)
    bootstrapSessionsRef.current.set(workspacePath || '', fresh)
    sessionsRef.current = [fresh]
    setSessions([fresh])
    setActiveSessionId(fresh.id)
    return fresh
  }, [workspacePath, flushPendingWrites])

  const purgeWorkspace = useCallback(
    (targetWorkspacePath: string | null) => {
      const targetKey = targetWorkspacePath || ''
      bootstrapSessionsRef.current.delete(targetKey)

      if (workspacePath === targetWorkspacePath) {
        sessionsRef.current = []
        setSessions([])
        setActiveSessionId('')
      }
    },
    [workspacePath]
  )

  const renameSession = useCallback(
    (sessionId: string, title: string) => {
      const clean = title.trim()
      if (!clean) return
      mutateSession(sessionId, (session) => ({ ...session, title: clean }))
    },
    [mutateSession]
  )

  const updateSessionContent = useCallback(
    (sessionId: string, content: { actionLogs?: AgentActionLog[]; promptQueue?: QueuedPromptRecord[] }) => {
      mutateSession(sessionId, (session) => ({
        ...session,
        actionLogs: content.actionLogs ?? session.actionLogs,
        promptQueue: content.promptQueue ?? session.promptQueue,
      }))
    },
    [mutateSession]
  )

  /** Replaces the plan history of a session; plans are persisted with the session itself. */
  const updateSessionPlans = useCallback(
    (sessionId: string, updater: (prev: AgentPlan[]) => AgentPlan[]) => {
      mutateSession(sessionId, (session) => ({ ...session, plans: updater(session.plans || []) }))
    },
    [mutateSession]
  )

  /**
   * Persists one exact plan revision synchronously with the approval flow. Debounced session
   * writes are appropriate for timeline updates, but execution must not start while the approved
   * request, interview decisions and milestones exist only in renderer memory.
   */
  const persistSessionPlan = useCallback(async (sessionId: string, plan: AgentPlan): Promise<boolean> => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || !window.electronAPI?.saveCodingSession) return false

    const currentPlans = session.plans || []
    const existingIndex = currentPlans.findIndex((candidate) => candidate.id === plan.id)
    const plans = [...currentPlans]
    if (existingIndex >= 0) plans[existingIndex] = plan
    else plans.push(plan)

    const next: CodingSession = {
      ...session,
      plans,
      updatedAt: new Date().toISOString(),
    }
    sessionsRef.current = sessionsRef.current.map((candidate) => candidate.id === sessionId ? next : candidate)
    setSessions(sessionsRef.current)

    return (await schedulePersist(next)) !== null
  }, [schedulePersist])

  /** Records a prompt run as started; the returned id identifies it on completion. */
  const beginExecutedPrompt = useCallback(
    (sessionId: string, prompt: string, agentMode: AgentExecutionMode): string => {
      const executedPrompt: ExecutedPrompt = {
        id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sessionId,
        prompt,
        startedAt: new Date().toISOString(),
        agentMode,
        outcome: 'running',
        totalSteps: 0,
        filesTouched: 0,
        additions: 0,
        deletions: 0,
      }
      mutateSession(sessionId, (session) => ({
        ...session,
        executedPrompts: [...session.executedPrompts, executedPrompt],
      }))
      return executedPrompt.id
    },
    [mutateSession]
  )

  /** Closes a prompt run with its outcome and the metrics collected while it ran. */
  const completeExecutedPrompt = useCallback(
    (sessionId: string, executedPromptId: string, result: ExecutedPromptResult) => {
      mutateSession(sessionId, (session) => {
        const executedPrompts = session.executedPrompts.map((item) =>
          item.id === executedPromptId
            ? {
                ...item,
                completedAt: new Date().toISOString(),
                outcome: result.outcome,
                totalSteps: result.totalSteps,
                filesTouched: result.metrics.filesTouched,
                additions: result.metrics.additions,
                deletions: result.metrics.deletions,
                summary: result.summary,
              }
            : item
        )

        // Fire-and-forget: embeds and upserts the completed prompt into the semantic history
        // index (see sidecarAppService.indexPromptHistory). Never awaited -- a failed or
        // skipped index write only means this one prompt won't surface in cross-project search.
        const completed = executedPrompts.find((p) => p.id === executedPromptId)
        if (completed && completed.prompt.trim() && workspacePath && window.electronAPI?.indexPromptHistory) {
          window.electronAPI
            .indexPromptHistory({
              id: completed.id,
              sessionId: completed.sessionId,
              workspacePath,
              prompt: completed.prompt,
              summary: completed.summary,
              outcome: completed.outcome,
              startedAt: completed.startedAt,
              completedAt: completed.completedAt,
            })
            .catch((err: any) => {
              logger.warn('useSessionHistory', `Could not index prompt history entry ${completed.id}: ${err?.message}`)
            })
        }

        return { ...session, executedPrompts }
      })
    },
    [mutateSession, workspacePath]
  )

  return {
    sessions,
    activeSession,
    activeSessionId,
    isLoadingSessions,
    createSession,
    switchSession,
    deleteSession,
    clearSessions,
    purgeWorkspace,
    renameSession,
    updateSessionContent,
    updateSessionPlans,
    persistSessionPlan,
    beginExecutedPrompt,
    completeExecutedPrompt,
  }
}
