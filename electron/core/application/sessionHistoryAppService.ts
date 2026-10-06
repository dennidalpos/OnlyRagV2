import type { CodingSession } from '../../../shared/types'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { sidecarAppService } from './sidecarAppService'
import { deleteConversationCheckpoints } from '../infrastructure/filesystem/agentCheckpointStore'

interface PendingDeletion {
  sessionId: string
  workspacePath: string | null
  ownerWorkspace: string | null
  checkpointIds: string[]
  historyDeleted: boolean
}

/** Use cases for the coding session history. */
export class SessionHistoryAppService {
  private readonly pendingDeletions = new Map<string, PendingDeletion>()

  private retainDeletion(sessionId: string, workspacePath?: string | null, session?: CodingSession): PendingDeletion {
    const key = JSON.stringify([workspacePath || null, sessionId])
    const pending = this.pendingDeletions.get(key) || {
      sessionId,
      workspacePath: workspacePath || null,
      ownerWorkspace: workspacePath || session?.workspacePath || null,
      checkpointIds: [],
      historyDeleted: false,
    }
    const ids = session?.executedPrompts?.map((prompt) => prompt.evidence?.checkpointId).filter((id): id is string => Boolean(id)) || []
    pending.checkpointIds = [...new Set([...pending.checkpointIds, ...ids])]
    this.pendingDeletions.set(key, pending)
    return pending
  }

  private async finishDeletions(pending: PendingDeletion[]): Promise<boolean> {
    if (pending.length === 0) return (await sidecarAppService.removePromptHistoryForSessions([])).success
    for (let start = 0; start < pending.length; start += 100) {
      if (!(await sidecarAppService.removePromptHistoryForSessions(pending.slice(start, start + 100).map((item) => item.sessionId))).success) return false
    }
    for (const item of pending) {
      if (!(await agentSessionStateRepository.clearSessionState(item.sessionId, item.ownerWorkspace))) return false
      if (item.ownerWorkspace) deleteConversationCheckpoints(item.ownerWorkspace, item.sessionId, item.checkpointIds)
      codingAgentLogger.removeSessionFromAuditLog(item.sessionId)
      this.pendingDeletions.delete(JSON.stringify([item.workspacePath, item.sessionId]))
    }
    return true
  }

  async listSessions(workspacePath?: string | null): Promise<CodingSession[]> {
    return sessionHistoryRepository.listSessions(workspacePath)
  }

  async saveSession(session: CodingSession): Promise<CodingSession | null> {
    return sessionHistoryRepository.saveSession(session)
  }

  async deleteSession(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    const session = (await sessionHistoryRepository.listSessions(workspacePath)).find((item) => item.id === sessionId)
    const pending = this.retainDeletion(sessionId, workspacePath, session)
    const deleted = await sessionHistoryRepository.deleteSession(sessionId, workspacePath)
    if (!deleted && !pending.historyDeleted) {
      if (!session) this.pendingDeletions.delete(JSON.stringify([workspacePath || null, sessionId]))
      return false
    }
    pending.historyDeleted = true
    return this.finishDeletions([pending])
  }

  async clearSessions(workspacePath?: string | null): Promise<boolean> {
    const sessions = (await sessionHistoryRepository.listSessions(workspacePath)).filter((session) => workspacePath || !session.workspacePath?.trim())
    for (const session of sessions) this.retainDeletion(session.id, workspacePath, session)
    const cleared = await sessionHistoryRepository.clearSessions(workspacePath)
    if (!cleared) return false
    const pending = [...this.pendingDeletions.values()].filter((item) => item.workspacePath === (workspacePath || null))
    for (const item of pending) item.historyDeleted = true
    return this.finishDeletions(pending)
  }
}

export const sessionHistoryAppService = new SessionHistoryAppService()
