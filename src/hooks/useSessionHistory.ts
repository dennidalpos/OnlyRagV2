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
const LEGACY_PLANS_STORAGE_KEY = 'onlyrag_session_plans_v1'
const MIGRATION_FLAG_KEY = 'onlyrag_sessions_migrated_to_filesystem_v1'
const PLANS_MIGRATION_FLAG_KEY = 'onlyrag_session_plans_migrated_to_filesystem_v1'
const PERSIST_DEBOUNCE_MS = 800

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
 * One-shot import of the plan history previously kept in localStorage, keyed by session id.
 * Plans now live inside their own session record, so the ones whose session no longer
 * exists are dropped instead of leaking as orphans forever.
 */
function migrateLegacyPlans(sessions: CodingSession[]): CodingSession[] {
  if (localStorage.getItem(PLANS_MIGRATION_FLAG_KEY) === 'done') return sessions
  const raw = localStorage.getItem(LEGACY_PLANS_STORAGE_KEY)
  if (!raw) {
    localStorage.setItem(PLANS_MIGRATION_FLAG_KEY, 'done')
    return sessions
  }

  try {
    const plansBySession = JSON.parse(raw) as Record<string, AgentPlan[]>
    const migrated = sessions.map((session) => {
      const legacyPlans = plansBySession?.[session.id]
      if (!Array.isArray(legacyPlans) || legacyPlans.length === 0 || (session.plans?.length ?? 0) > 0) return session
      return { ...session, plans: legacyPlans }
    })
    localStorage.removeItem(LEGACY_PLANS_STORAGE_KEY)
    localStorage.setItem(PLANS_MIGRATION_FLAG_KEY, 'done')
    return migrated
  } catch (err: any) {
    logger.warn('useSessionHistory', `Legacy plan migration failed, will retry on next launch: ${err?.message}`)
    return sessions
  }
}

/**
 * Owns the coding session history of the active workspace. The filesystem store behind
 * the `sessions:*` IPC channels is the single source of truth: this hook mirrors it in
 * memory and writes back debounced.
 */
export function useSessionHistory(workspacePath: string | null) {
  const [sessions, setSessions] = useState<CodingSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(true)

  const pendingWritesRef = useRef<Map<string, CodingSession>>(new Map())
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Bootstrap session created for an empty workspace store, kept per workspace so a
   * repeated load (React StrictMode double-invoke, or a workspace revisited before the
   * debounced write lands) reuses the same record instead of creating a duplicate.
   */
  const bootstrapSessionsRef = useRef<Map<string, CodingSession>>(new Map())

  const flushPendingWrites = useCallback(async () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    const pending = Array.from(pendingWritesRef.current.values()).filter(hasPersistableContent)
    pendingWritesRef.current.clear()
    if (pending.length === 0 || !window.electronAPI?.saveCodingSession) return

    for (const session of pending) {
      try {
        const saved = await window.electronAPI.saveCodingSession(session)
        // The main process derives the session title from the first executed prompt:
        // adopt it so the sidebar shows exactly what is stored on disk.
        if (saved && saved.title !== session.title) {
          setSessions((prev) => prev.map((s) => (s.id === saved.id ? { ...s, title: saved.title } : s)))
        }
      } catch (err: any) {
        logger.warn('useSessionHistory', `Could not persist session ${session.id}: ${err?.message}`)
      }
    }
  }, [])

  const schedulePersist = useCallback(
    (session: CodingSession) => {
      pendingWritesRef.current.set(session.id, session)
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persistTimerRef.current = setTimeout(() => {
        void flushPendingWrites()
      }, PERSIST_DEBOUNCE_MS)
    },
    [flushPendingWrites]
  )

  const mutateSession = useCallback(
    (sessionId: string, mutator: (session: CodingSession) => CodingSession) => {
      if (!sessionId) return
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) return session
          const next = { ...mutator(session), updatedAt: new Date().toISOString() }
          schedulePersist(next)
          return next
        })
      )
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
        setSessions([fresh])
        setActiveSessionId(fresh.id)
        schedulePersist(fresh)
      } else {
        const withPlans = migrateLegacyPlans(stored)
        setSessions(withPlans)
        setActiveSessionId(withPlans[0].id)
        withPlans.forEach((session, index) => {
          if (session !== stored[index]) schedulePersist(session)
        })
      }
      setIsLoadingSessions(false)
    }

    void loadSessions()
    return () => {
      cancelled = true
    }
  }, [workspacePath, flushPendingWrites, schedulePersist])

  // Never lose the last edits when the view unmounts or the window closes.
  useEffect(() => {
    const handleBeforeUnload = () => {
      void flushPendingWrites()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      void flushPendingWrites()
    }
  }, [flushPendingWrites])

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null

  const createSession = useCallback((): CodingSession => {
    const fresh = createEmptySession(workspacePath)
    bootstrapSessionsRef.current.set(workspacePath || '', fresh)
    setSessions((prev) => [fresh, ...prev])
    setActiveSessionId(fresh.id)
    schedulePersist(fresh)
    return fresh
  }, [workspacePath, schedulePersist])

  const switchSession = useCallback(
    (sessionId: string): CodingSession | null => {
      const target = sessions.find((s) => s.id === sessionId)
      if (!target) return null
      void flushPendingWrites()
      setActiveSessionId(target.id)
      return target
    },
    [sessions, flushPendingWrites]
  )

  /** Deletes a session and returns the session that became active, when it changed. */
  const deleteSession = useCallback(
    async (sessionId: string): Promise<CodingSession | null> => {
      pendingWritesRef.current.delete(sessionId)
      if (window.electronAPI?.deleteCodingSession) {
        try {
          await window.electronAPI.deleteCodingSession(sessionId, workspacePath)
        } catch (err: any) {
          logger.warn('useSessionHistory', `Could not delete session ${sessionId}: ${err?.message}`)
        }
      }

      const remaining = sessions.filter((s) => s.id !== sessionId)
      if (remaining.length === 0) {
        const fresh = createEmptySession(workspacePath)
        bootstrapSessionsRef.current.set(workspacePath || '', fresh)
        setSessions([fresh])
        setActiveSessionId(fresh.id)
        schedulePersist(fresh)
        return fresh
      }

      setSessions(remaining)
      if (sessionId === activeSessionId) {
        setActiveSessionId(remaining[0].id)
        return remaining[0]
      }
      return null
    },
    [sessions, activeSessionId, workspacePath, schedulePersist]
  )

  /** Deletes the whole history of the active workspace and starts from a clean session. */
  const clearSessions = useCallback(async (): Promise<CodingSession> => {
    pendingWritesRef.current.clear()
    if (window.electronAPI?.clearCodingSessions) {
      try {
        await window.electronAPI.clearCodingSessions(workspacePath)
      } catch (err: any) {
        logger.warn('useSessionHistory', `Could not clear session history: ${err?.message}`)
      }
    }
    const fresh = createEmptySession(workspacePath)
    bootstrapSessionsRef.current.set(workspacePath || '', fresh)
    setSessions([fresh])
    setActiveSessionId(fresh.id)
    return fresh
  }, [workspacePath])

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
      mutateSession(sessionId, (session) => ({
        ...session,
        executedPrompts: session.executedPrompts.map((item) =>
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
        ),
      }))
    },
    [mutateSession]
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
    renameSession,
    updateSessionContent,
    updateSessionPlans,
    beginExecutedPrompt,
    completeExecutedPrompt,
  }
}
