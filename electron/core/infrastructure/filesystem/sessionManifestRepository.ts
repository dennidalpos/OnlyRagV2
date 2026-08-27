import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { logger } from '../../../diagnostics'
import { sessionManifestSchema, type SessionManifest } from '../../domain/sessions/sessionBaselineContract'
import { safeAtomicWrite } from './safeAtomicFileWriter'

const MANIFEST_FILE_PREFIX = '.session_manifest_'
const MANIFEST_FILE_SUFFIX = '.json'

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class SessionManifestRepository {
  private getStorageDir(workspaceRoot: string): string {
    if (fs.existsSync(workspaceRoot)) {
      return path.join(workspaceRoot, '.onlyrag', 'sessions')
    }
    return path.join(os.homedir(), '.onlyrag_v2', 'sessions')
  }

  private getManifestPath(sessionId: string, workspaceRoot: string): string {
    return path.join(this.getStorageDir(workspaceRoot), `${MANIFEST_FILE_PREFIX}${safeSessionId(sessionId)}${MANIFEST_FILE_SUFFIX}`)
  }

  public async saveManifest(manifest: SessionManifest): Promise<boolean> {
    const parsed = sessionManifestSchema.safeParse(manifest)
    if (!parsed.success) {
      logger.log('WARN', 'SessionManifestRepo', `Rejected invalid manifest for session ${manifest?.sessionId || 'unknown'}`)
      return false
    }

    try {
      const filePath = this.getManifestPath(parsed.data.sessionId, parsed.data.workspaceRoot)
      return await safeAtomicWrite(filePath, JSON.stringify(parsed.data, null, 2))
    } catch (err: any) {
      logger.log('WARN', 'SessionManifestRepo', `Failed saving manifest for session ${parsed.data.sessionId}: ${err.message}`)
      return false
    }
  }

  public async loadManifest(sessionId: string, workspaceRoot: string): Promise<SessionManifest | null> {
    try {
      const filePath = this.getManifestPath(sessionId, workspaceRoot)
      if (!fs.existsSync(filePath)) return null
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const parsed = sessionManifestSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        logger.log('WARN', 'SessionManifestRepo', `Rejected invalid persisted manifest for session ${sessionId}`)
        return null
      }
      return parsed.data
    } catch (err: any) {
      logger.log('WARN', 'SessionManifestRepo', `Failed loading manifest for session ${sessionId}: ${err.message}`)
      return null
    }
  }

  public async clearManifest(sessionId: string, workspaceRoot: string): Promise<boolean> {
    try {
      const filePath = this.getManifestPath(sessionId, workspaceRoot)
      if (fs.existsSync(filePath)) await fs.promises.unlink(filePath)
      return true
    } catch (err: any) {
      logger.log('WARN', 'SessionManifestRepo', `Failed clearing manifest for session ${sessionId}: ${err.message}`)
      return false
    }
  }
}

export const sessionManifestRepository = new SessionManifestRepository()
