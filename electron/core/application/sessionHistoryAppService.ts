import type { CodingSession } from '../../../src/types'
import { logger } from '../../diagnostics'
import { normalizeSession } from '../domain/sessions/sessionHistoryDomain'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { sidecarAppService } from './sidecarAppService'

/**
 * Use cases for the coding session history. Owns the full lifecycle of a session:
 * the history record itself, the agent runtime state file used to resume it, and
 * its entries in the audit log, so deleting a session never leaves residues behind.
 */
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
    codingAgentLogger.clearAuditLog()
    await sidecarAppService.removePromptHistoryForSessions(sessionIds)
    return cleared
  }

  /**
   * One-shot import of the sessions the renderer used to persist in localStorage
   * ('onlyrag_coding_sessions_v2'). Records are grouped by their own workspacePath
   * so each project store receives its own history, and existing on-disk sessions
   * are never overwritten. Returns how many records were actually imported.
   */
  async migrateLegacySessions(rawSessions: unknown): Promise<{ migrated: number }> {
    if (!Array.isArray(rawSessions) || rawSessions.length === 0) return { migrated: 0 }

    const byWorkspace = new Map<string | null, CodingSession[]>()
    for (const raw of rawSessions) {
      const session = normalizeSession(raw)
      if (!session) continue
      const bucket = byWorkspace.get(session.workspacePath) || []
      bucket.push(session)
      byWorkspace.set(session.workspacePath, bucket)
    }

    let migrated = 0
    for (const [workspacePath, sessions] of byWorkspace) {
      migrated += await sessionHistoryRepository.mergeSessions(workspacePath, sessions)
    }

    logger.log('INFO', 'SessionHistoryAppService', `Migrated ${migrated} legacy coding session(s) from localStorage to the filesystem store.`)
    return { migrated }
  }
}

export const sessionHistoryAppService = new SessionHistoryAppService()
