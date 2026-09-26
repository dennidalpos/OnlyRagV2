import type { CodingSession } from '../../../shared/types'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { sidecarAppService } from './sidecarAppService'

/** Use cases for the coding session history. */
export class SessionHistoryAppService {
  async listSessions(workspacePath?: string | null): Promise<CodingSession[]> {
    return sessionHistoryRepository.listSessions(workspacePath)
  }

  async saveSession(session: CodingSession): Promise<CodingSession | null> {
    return sessionHistoryRepository.saveSession(session)
  }

  async deleteSession(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    const deleted = await sessionHistoryRepository.deleteSession(sessionId, workspacePath)
    await agentSessionStateRepository.clearSessionState(sessionId, workspacePath)
    codingAgentLogger.removeSessionFromAuditLog(sessionId)
    await sidecarAppService.removePromptHistoryForSessions([sessionId])
    return deleted
  }

  async clearSessions(workspacePath?: string | null): Promise<boolean> {
    // Collected before clearing: the local store is the only place that still knows which
    // session ids belonged to this workspace once it's wiped.
    const sessionIds = (await sessionHistoryRepository.listSessions(workspacePath)).map((s) => s.id)
    const cleared = await sessionHistoryRepository.clearSessions(workspacePath)
    await agentSessionStateRepository.clearAllSessionStates(workspacePath)
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
