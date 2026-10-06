import fs from 'node:fs'
import { workspaceMetadataHistoryPath } from './workspaceMetadataDirectory'
import path from 'node:path'
import { logger } from '../logging/logger'
import type { CodingSession } from '../../../../shared/types'
import { normalizeSession, sortSessionsByRecency, upsertSession } from '../../domain/sessions/sessionHistoryDomain'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { userDataSessionsDir } from './userDataRoot'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

const HISTORY_FILE_NAME = 'history.json'
const FALLBACK_HISTORY_FILE_NAME = 'session_history.json'
const STORE_VERSION = 1

interface SessionHistoryStore {
  version: number
  sessions: CodingSession[]
}

/** Single filesystem store for the coding session history (sessions and their ExecutedPrompt records). */
export class SessionHistoryRepository {
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly customFallbackDir?: string

  constructor(customFallbackDir?: string) {
    this.customFallbackDir = customFallbackDir
  }

  private getFallbackDir(): string {
    return this.customFallbackDir || userDataSessionsDir()
  }

  private historyFilePath(dir: string): string {
    return path.join(dir, dir === this.getFallbackDir() ? FALLBACK_HISTORY_FILE_NAME : HISTORY_FILE_NAME)
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release: (() => void) | undefined
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release?.()
    }
  }

  private getStorageDir(workspacePath?: string | null): string {
    if (workspacePath && fs.existsSync(workspacePath)) {
      const stateDir = path.dirname(workspaceMetadataHistoryPath(workspacePath))
      if (!fs.existsSync(stateDir)) {
        try {
          fs.mkdirSync(stateDir, { recursive: true })
        } catch (err: unknown) {
          logger.log('WARN', 'SessionHistoryRepo', `Could not create .onlyrag/sessions dir in workspace: ${errorMessage(err)}`)
        }
      }
      if (fs.existsSync(stateDir)) return stateDir
    }

    const fallbackDir = this.getFallbackDir()
    if (!fs.existsSync(fallbackDir)) {
      try {
        fs.mkdirSync(fallbackDir, { recursive: true })
      } catch (err: unknown) {
        logger.log('WARN', 'SessionHistoryRepo', `Could not create fallback history dir: ${errorMessage(err)}`)
      }
    }
    return fallbackDir
  }

  /** Every directory a session for this workspace could legitimately be stored in: the workspace-scoped `.onlyrag/sessions` folder (if the workspace still exists on disk) and the home fallback used for standalone sessions or workspaces that were unavailable at save */
  private getCandidateStorageDirs(workspacePath?: string | null): string[] {
    const dirs: string[] = []
    if (workspacePath && fs.existsSync(workspacePath)) {
      dirs.push(path.dirname(workspaceMetadataHistoryPath(workspacePath)))
    }
    dirs.push(this.getFallbackDir())
    return dirs
  }

  private async readStoreAtDir(dir: string): Promise<CodingSession[]> {
    const filePath = this.historyFilePath(dir)
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as SessionHistoryStore
      if (!parsed || (parsed.version !== undefined && parsed.version !== STORE_VERSION) || !Array.isArray(parsed.sessions)) {
        throw new Error('Unsupported session history envelope')
      }
      const sessions = parsed.sessions.map((session) => {
        const normalized = normalizeSession(session)
        if (!normalized) throw new Error('Invalid retained session')
        for (const key of ['actionLogs', 'executedPrompts', 'plans', 'promptQueue', 'pinnedFilePaths'] as const) {
          const original = session[key]
          if (original !== undefined && (!Array.isArray(original) || (original.length > 0 && original.length !== normalized[key]?.length))) {
            throw new Error(`Unsupported retained session field: ${key}`)
          }
        }
        return normalized
      })
      if (new Set(sessions.map((session) => session.id)).size !== sessions.length) throw new Error('Duplicate retained session identities')
      return sessions
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return []
      logger.log('WARN', 'SessionHistoryRepo', `Failed reading session history at ${filePath}: ${errorMessage(err)}`)
      throw new Error('Session history is unreadable; original data is preserved')
    }
  }

  private async writeStoreAtDir(dir: string, sessions: CodingSession[]): Promise<boolean> {
    const filePath = this.historyFilePath(dir)
    try {
      const payload: SessionHistoryStore = { version: STORE_VERSION, sessions }
      return await safeAtomicWrite(filePath, JSON.stringify(payload, null, 2))
    } catch (err: unknown) {
      logger.log('WARN', 'SessionHistoryRepo', `Failed writing session history at ${filePath}: ${errorMessage(err)}`)
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

  public async migrateStandaloneSessions(workspacePath: string): Promise<number> {
    return this.runExclusive(async () => {
      const fallbackDir = this.getFallbackDir()
      const legacySessions = await this.readStoreAtDir(fallbackDir)
      const standaloneSessions = legacySessions.filter((session) => !session.workspacePath)
      if (standaloneSessions.length === 0) return 0

      const targetDir = this.getStorageDir(workspacePath)
      const targetSessions = await this.readStoreAtDir(targetDir)
      const targetIds = new Set(targetSessions.map((session) => session.id))
      const migrated = standaloneSessions.filter((session) => !targetIds.has(session.id)).map((session) => ({ ...session, workspacePath }))
      const targetSaved = await this.writeStoreAtDir(targetDir, sortSessionsByRecency([...targetSessions, ...migrated]))
      if (!targetSaved) return 0

      const standaloneIds = new Set(standaloneSessions.map((session) => session.id))
      const fallbackSaved = await this.writeStoreAtDir(
        fallbackDir,
        legacySessions.filter((session) => !standaloneIds.has(session.id)),
      )
      return fallbackSaved ? migrated.length : 0
    })
  }

  public async saveSession(session: CodingSession): Promise<CodingSession | null> {
    const normalized = normalizeSession(session)
    if (!normalized) return null
    return this.runExclusive(async () => {
      const sessions = await this.readStore(normalized.workspacePath)
      const saved = await this.writeStore(normalized.workspacePath, upsertSession(sessions, normalized))
      return saved ? normalized : null
    })
  }

  /** Every matching store must acknowledge removal; false means no record was found. */
  public async deleteSession(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    return this.runExclusive(async () => {
      let removedAny = false
      const stores = []
      for (const dir of this.getCandidateStorageDirs(workspacePath)) stores.push({ dir, sessions: await this.readStoreAtDir(dir) })
      for (const { dir, sessions } of stores) {
        if (sessions.length === 0) continue
        const remaining = sessions.filter((session) => session.id !== sessionId)
        if (remaining.length === sessions.length) continue
        const wrote = await this.writeStoreAtDir(dir, remaining)
        if (!wrote) throw new Error('Session deletion was not acknowledged; remaining stores and recovery assets are preserved')
        removedAny = true
      }
      return removedAny
    })
  }

  public async clearSessions(workspacePath?: string | null): Promise<boolean> {
    return this.runExclusive(async () => {
      const normalizedTarget = workspacePath ? path.normalize(workspacePath).toLowerCase() : null
      const fallbackDir = this.getFallbackDir()
      const fallbackSessions = await this.readStoreAtDir(fallbackDir)
      const workspaceDir = workspacePath && fs.existsSync(workspacePath) ? path.dirname(workspaceMetadataHistoryPath(workspacePath)) : null
      // Read every affected store before deleting from any of them.
      if (workspaceDir) await this.readStoreAtDir(workspaceDir)

      if (workspaceDir) {
        if (fs.existsSync(workspaceDir)) {
          if (!(await this.writeStoreAtDir(workspaceDir, []))) return false
        }
      }

      if (fs.existsSync(fallbackDir)) {
        if (fallbackSessions.length > 0) {
          const remaining = normalizedTarget
            ? fallbackSessions.filter((session) => (session.workspacePath ? path.normalize(session.workspacePath).toLowerCase() : null) !== normalizedTarget)
            : fallbackSessions.filter((session) => !!session.workspacePath && session.workspacePath.trim().length > 0)

          if (remaining.length !== fallbackSessions.length) {
            if (!(await this.writeStoreAtDir(fallbackDir, remaining))) return false
          }
        }
      }

      return true
    })
  }
}

export const sessionHistoryRepository = new SessionHistoryRepository()
