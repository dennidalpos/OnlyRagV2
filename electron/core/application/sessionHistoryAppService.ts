import type { CodingSession } from '../../../shared/types'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { sidecarAppService } from './sidecarAppService'
import { deleteConversationCheckpoints } from '../infrastructure/filesystem/agentCheckpointStore'

/** Use cases for the coding session history. */
export class SessionHistoryAppService {
  async listSessions(workspacePath?: string | null): Promise<CodingSession[]> {
    return sessionHistoryRepository.listSessions(workspacePath)
  }

  async saveSession(session: CodingSession): Promise<CodingSession | null> {
    return sessionHistoryRepository.saveSession(session)
  }

  async deleteSession(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    const session = (await sessionHistoryRepository.listSessions(workspacePath)).find((item) => item.id === sessionId)
    const ownerWorkspace = workspacePath || session?.workspacePath
    if (ownerWorkspace) {
      const checkpointIds = session?.executedPrompts?.map((prompt) => prompt.evidence?.checkpointId).filter((id): id is string => Boolean(id)) || []
      deleteConversationCheckpoints(ownerWorkspace, sessionId, checkpointIds)
    }
    if (!(await agentSessionStateRepository.clearSessionState(sessionId, workspacePath))) return false
    const deleted = await sessionHistoryRepository.deleteSession(sessionId, workspacePath)
    if (!deleted) return false
    codingAgentLogger.removeSessionFromAuditLog(sessionId)
    await sidecarAppService.removePromptHistoryForSessions([sessionId])
    return deleted
  }

  async clearSessions(workspacePath?: string | null): Promise<boolean> {
    // Collected before clearing: the local store is the only place that still knows which
    // session ids belonged to this workspace once it's wiped.
    const sessions = await sessionHistoryRepository.listSessions(workspacePath)
    const sessionIds = sessions.map((s) => s.id)
    if (workspacePath) {
      for (const session of sessions) {
        const checkpointIds = session.executedPrompts?.map((prompt) => prompt.evidence?.checkpointId).filter((id): id is string => Boolean(id)) || []
        deleteConversationCheckpoints(workspacePath, session.id, checkpointIds)
      }
    }
    if (!(await agentSessionStateRepository.clearAllSessionStates(workspacePath))) return false
    const cleared = await sessionHistoryRepository.clearSessions(workspacePath)
    if (!cleared) return false
    if (sessionIds.length > 0) {
      for (const sid of sessionIds) {
        codingAgentLogger.removeSessionFromAuditLog(sid)
      }
    } else if (!workspacePath) {
      codingAgentLogger.clearAuditLog()
    }
    await sidecarAppService.removePromptHistoryForSessions(sessionIds)
    return cleared
  }
}

export const sessionHistoryAppService = new SessionHistoryAppService()
