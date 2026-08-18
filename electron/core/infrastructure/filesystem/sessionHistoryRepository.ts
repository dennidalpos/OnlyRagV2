import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../../../diagnostics'
import type { CodingSession } from '../../../../src/types'
import { normalizeSession, sortSessionsByRecency, upsertSession } from '../../domain/sessions/sessionHistoryDomain'

const HISTORY_FILE_NAME = 'session_history.json'
const STORE_VERSION = 1

interface SessionHistoryStore {
  version: number
  sessions: CodingSession[]
}

/**
 * Single filesystem store for the coding session history (sessions and their
 * ExecutedPrompt records). Workspace-scoped sessions live in the project's
 * `.onlyrag` folder; standalone sessions fall back to the user home store.
 * This is the only persistence for session history — the renderer keeps no copy.
 */
export class SessionHistoryRepository {
  private getStorageDir(workspacePath?: string | null): string {
    if (workspacePath && fs.existsSync(workspacePath)) {
      const stateDir = path.join(workspacePath, '.onlyrag')
      if (!fs.existsSync(stateDir)) {
        try {
          fs.mkdirSync(stateDir, { recursive: true })
        } catch (err: any) {
          logger.log('WARN', 'SessionHistoryRepo', `Could not create .onlyrag dir in workspace: ${err.message}`)
        }
      }
      if (fs.existsSync(stateDir)) return stateDir
    }

    const fallbackDir = path.join(os.homedir(), '.onlyrag_v2', 'sessions')
    if (!fs.existsSync(fallbackDir)) {
      try {
        fs.mkdirSync(fallbackDir, { recursive: true })
      } catch (err: any) {
        logger.log('WARN', 'SessionHistoryRepo', `Could not create fallback history dir: ${err.message}`)
      }
    }
    return fallbackDir
  }

  private getHistoryFilePath(workspacePath?: string | null): string {
    return path.join(this.getStorageDir(workspacePath), HISTORY_FILE_NAME)
  }

  private async readStore(workspacePath?: string | null): Promise<CodingSession[]> {
    const filePath = this.getHistoryFilePath(workspacePath)
    if (!fs.existsSync(filePath)) return []
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as SessionHistoryStore
      if (!parsed || !Array.isArray(parsed.sessions)) return []
      return parsed.sessions
        .map((session) => normalizeSession(session))
        .filter((session): session is CodingSession => session !== null)
    } catch (err: any) {
      logger.log('WARN', 'SessionHistoryRepo', `Failed reading session history at ${filePath}: ${err.message}`)
      return []
    }
  }

  private async writeStore(workspacePath: string | null | undefined, sessions: CodingSession[]): Promise<boolean> {
    const filePath = this.getHistoryFilePath(workspacePath)
    try {
      const payload: SessionHistoryStore = { version: STORE_VERSION, sessions }
      const tempPath = `${filePath}.tmp`
      await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8')
      await fs.promises.rename(tempPath, filePath)
      return true
    } catch (err: any) {
      logger.log('WARN', 'SessionHistoryRepo', `Failed writing session history at ${filePath}: ${err.message}`)
      return false
    }
  }

  public async listSessions(workspacePath?: string | null): Promise<CodingSession[]> {
    return sortSessionsByRecency(await this.readStore(workspacePath))
  }

  public async saveSession(session: CodingSession): Promise<CodingSession | null> {
    const normalized = normalizeSession(session)
    if (!normalized) return null
    const sessions = await this.readStore(normalized.workspacePath)
    const saved = await this.writeStore(normalized.workspacePath, upsertSession(sessions, normalized))
    return saved ? normalized : null
  }

  public async deleteSession(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    const sessions = await this.readStore(workspacePath)
    const remaining = sessions.filter((session) => session.id !== sessionId)
    if (remaining.length === sessions.length) return true
    return this.writeStore(workspacePath, remaining)
  }

  public async clearSessions(workspacePath?: string | null): Promise<boolean> {
    return this.writeStore(workspacePath, [])
  }

  /**
   * Merges records coming from the one-shot localStorage migration, keeping any
   * session already stored on disk (the filesystem store always wins).
   */
  public async mergeSessions(workspacePath: string | null, incoming: CodingSession[]): Promise<number> {
    const existing = await this.readStore(workspacePath)
    const existingIds = new Set(existing.map((session) => session.id))
    const newcomers = incoming.filter((session) => !existingIds.has(session.id))
    if (newcomers.length === 0) return 0
    const saved = await this.writeStore(workspacePath, sortSessionsByRecency([...existing, ...newcomers]))
    return saved ? newcomers.length : 0
  }
}

export const sessionHistoryRepository = new SessionHistoryRepository()
