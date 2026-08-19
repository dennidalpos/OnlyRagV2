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

  /**
   * Every directory a session for this workspace could legitimately be stored in: the
   * workspace-scoped `.onlyrag` folder (if the workspace still exists on disk) and the home
   * fallback used for standalone sessions or workspaces that were unavailable at save time.
   * Delete/clear-by-id must check every candidate, not just the one implied by the caller's
   * *current* workspacePath -- a session saved standalone (or under a workspace that later
   * became briefly inaccessible) would otherwise never be found, and would linger forever as
   * an un-deletable ghost entry even though the UI reports the delete as successful.
   */
  private getCandidateStorageDirs(workspacePath?: string | null): string[] {
    const dirs: string[] = []
    if (workspacePath && fs.existsSync(workspacePath)) {
      dirs.push(path.join(workspacePath, '.onlyrag'))
    }
    dirs.push(path.join(os.homedir(), '.onlyrag_v2', 'sessions'))
    return dirs
  }

  private async readStoreAtDir(dir: string): Promise<CodingSession[]> {
    const filePath = path.join(dir, HISTORY_FILE_NAME)
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

  private async writeStoreAtDir(dir: string, sessions: CodingSession[]): Promise<boolean> {
    const filePath = path.join(dir, HISTORY_FILE_NAME)
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

  private async readStore(workspacePath?: string | null): Promise<CodingSession[]> {
    return this.readStoreAtDir(this.getStorageDir(workspacePath))
  }

  private async writeStore(workspacePath: string | null | undefined, sessions: CodingSession[]): Promise<boolean> {
    return this.writeStoreAtDir(this.getStorageDir(workspacePath), sessions)
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

  /**
   * Returns true only if a matching session was actually found and removed from disk in at
   * least one candidate store -- unlike the single-store lookup this used to be, a "not
   * found here" no longer reads as success, so a genuine failure is never masked as one.
   */
  public async deleteSession(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    let removedAny = false
    for (const dir of this.getCandidateStorageDirs(workspacePath)) {
      const sessions = await this.readStoreAtDir(dir)
      if (sessions.length === 0) continue
      const remaining = sessions.filter((session) => session.id !== sessionId)
      if (remaining.length === sessions.length) continue
      const wrote = await this.writeStoreAtDir(dir, remaining)
      removedAny = removedAny || wrote
    }
    return removedAny
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
