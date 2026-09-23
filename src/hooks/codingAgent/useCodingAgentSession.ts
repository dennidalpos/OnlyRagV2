import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentActionLog, AgentPlan } from '../../types'
import type { useSessionHistory } from '../useSessionHistory'
import type { useCodingAgentExecution } from './useCodingAgentExecution'

const EMPTY_PLANS: AgentPlan[] = []

type SessionHistoryApi = ReturnType<typeof useSessionHistory>
type ExecutionApi = ReturnType<typeof useCodingAgentExecution>

/** Plan revisions of the active conversation; needed by the execution hook before the session handlers exist. */
export function useActiveSessionPlans({
  activeSession,
  activeSessionId,
  updateSessionPlans,
  persistSessionPlan,
}: Pick<SessionHistoryApi, 'activeSession' | 'activeSessionId' | 'updateSessionPlans' | 'persistSessionPlan'>) {
  const activeSessionPlans = activeSession?.plans || EMPTY_PLANS
  const updateActiveSessionPlans = useCallback(
    (updater: (prev: AgentPlan[]) => AgentPlan[]) => {
      if (!activeSessionId) return
      updateSessionPlans(activeSessionId, updater)
    },
    [activeSessionId, updateSessionPlans],
  )
  const persistActiveSessionPlan = useCallback(
    (plan: AgentPlan) => (activeSessionId ? persistSessionPlan(activeSessionId, plan) : Promise.resolve(false)),
    [activeSessionId, persistSessionPlan],
  )
  return { activeSessionPlans, updateActiveSessionPlans, persistActiveSessionPlan }
}

export interface UseCodingAgentSessionOptions {
  workspacePath: string | null
  history: SessionHistoryApi
  execution: Pick<ExecutionApi, 'resetRunView' | 'clearConversation' | 'hydrateFromSession' | 'promptQueue' | 'contextBudget' | 'forceContextCompaction'>
  actionLogs: AgentActionLog[]
  /** Clears attachments and pinned files, which belong to a single conversation. */
  clearRunContext: () => void
  selectProject: (workspacePath: string) => void
  removeProject: (workspacePath: string) => void
}

/** Conversation switching and persistence: each conversation keeps its own timeline, queue and context settings. */
export function useCodingAgentSession({
  workspacePath,
  history,
  execution,
  actionLogs,
  clearRunContext,
  selectProject,
  removeProject,
}: UseCodingAgentSessionOptions) {
  const { activeSessionId, activeSession, updateSessionContent } = history
  const { hydrateFromSession, resetRunView, clearConversation, promptQueue, contextBudget, forceContextCompaction } = execution

  const prevSessionIdRef = useRef('')
  const [contentSessionId, setContentSessionId] = useState('')
  useEffect(() => {
    if (activeSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = activeSessionId
      hydrateFromSession(activeSession)
      setContentSessionId(activeSessionId)
    }
  }, [activeSessionId, activeSession, hydrateFromSession])

  useEffect(() => {
    if (!activeSessionId || contentSessionId !== activeSessionId) return
    updateSessionContent(activeSessionId, { actionLogs, promptQueue, contextBudget: contextBudget || undefined, forceContextCompaction })
  }, [activeSessionId, actionLogs, contentSessionId, contextBudget, forceContextCompaction, promptQueue, updateSessionContent])

  const resetConversation = () => {
    resetRunView()
    clearConversation()
    clearRunContext()
  }

  const handleCreateSession = () => {
    resetConversation()
    history.createSession()
  }

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId === activeSessionId) return
    resetRunView()
    history.switchSession(sessionId)
  }

  const jumpToProjectAndSession = (targetWorkspacePath: string, sessionId: string) => {
    if (targetWorkspacePath === workspacePath) {
      handleSwitchSession(sessionId)
      return
    }
    resetRunView()
    selectProject(targetWorkspacePath)
    setTimeout(() => history.switchSession(sessionId), 150)
  }

  const handleDeleteSession = (sessionId: string) => {
    if (sessionId === activeSessionId) resetConversation()
    history.deleteSession(sessionId)
  }

  const handleRenameSession = (sessionId: string, newTitle: string) => history.renameSession(sessionId, newTitle)

  /** Purges cached sessions of the removed workspace, clears the view if it was active, then unregisters it. */
  const handleRemoveProject = (pathStr: string) => {
    history.purgeWorkspace(pathStr)
    if (pathStr === workspacePath) resetConversation()
    removeProject(pathStr)
  }

  return {
    workspaceSessions: history.sessions,
    activeSession,
    activeSessionId,
    handleCreateSession,
    handleSwitchSession,
    jumpToProjectAndSession,
    handleDeleteSession,
    handleRenameSession,
    handleRemoveProject,
  }
}
