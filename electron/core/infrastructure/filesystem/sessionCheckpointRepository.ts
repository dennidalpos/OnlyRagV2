import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { logger } from '../../../diagnostics'
import { baselineSnapshotSchema, type BaselineSnapshot } from '../../domain/sessions/sessionBaselineContract'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { isPathWithinRoot } from '../../domain/agent/pathContainment'

const RECOVERY_DIR = '.session_recovery'

interface SessionBackup {
  relativePath: string
  originalContent: string
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function backupFileName(relativePath: string): string {
  return `${crypto.createHash('sha256').update(relativePath, 'utf-8').digest('hex')}.bak`
}

export class SessionCheckpointRepository {
  private getStorageDir(workspaceRoot: string): string {
    if (fs.existsSync(workspaceRoot)) return path.join(workspaceRoot, '.onlyrag', 'sessions')
    return path.join(os.homedir(), '.onlyrag_v2', 'sessions')
  }

  private getRecoveryDir(snapshot: BaselineSnapshot): string {
    return path.join(this.getStorageDir(snapshot.workspaceRoot), RECOVERY_DIR, safeId(snapshot.snapshotId))
  }

  public async saveCheckpoint(snapshot: BaselineSnapshot, backups: SessionBackup[] = []): Promise<boolean> {
    const parsed = baselineSnapshotSchema.safeParse(snapshot)
    if (!parsed.success || backups.some((backup) => !isPathWithinRoot(parsed.data.workspaceRoot, path.resolve(parsed.data.workspaceRoot, backup.relativePath), false))) {
      logger.log('WARN', 'SessionCheckpointRepo', `Rejected invalid checkpoint ${snapshot?.snapshotId || 'unknown'}`)
      return false
    }

    try {
      const recoveryDir = this.getRecoveryDir(parsed.data)
      const backupByPath = new Map(backups.map((backup) => [backup.relativePath.replace(/\\/g, '/'), backup]))
      for (const entry of parsed.data.entries) {
        if (entry.state !== 'file') continue
        const backup = backupByPath.get(entry.relativePath.replace(/\\/g, '/'))
        if (!backup) {
          logger.log('WARN', 'SessionCheckpointRepo', `Missing backup for file ${entry.relativePath}`)
          return false
        }
        await safeAtomicWrite(path.join(recoveryDir, backupFileName(entry.relativePath)), backup.originalContent)
      }
      return await safeAtomicWrite(
        path.join(this.getStorageDir(parsed.data.workspaceRoot), `.session_checkpoint_${safeId(parsed.data.snapshotId)}.json`),
        JSON.stringify(parsed.data, null, 2)
      )
    } catch (err: any) {
      logger.log('WARN', 'SessionCheckpointRepo', `Failed saving checkpoint ${parsed.data.snapshotId}: ${err.message}`)
      return false
    }
  }

  public async recoverSession(snapshotId: string, workspaceRoot: string): Promise<{ restoredCount: number; errors: string[] }> {
    const snapshotPath = path.join(this.getStorageDir(workspaceRoot), `.session_checkpoint_${safeId(snapshotId)}.json`)
    const result = { restoredCount: 0, errors: [] as string[] }

    try {
      if (!fs.existsSync(snapshotPath)) return result
      const raw = await fs.promises.readFile(snapshotPath, 'utf-8')
      const parsed = baselineSnapshotSchema.safeParse(JSON.parse(raw))
      if (!parsed.success || path.resolve(parsed.data.workspaceRoot) !== path.resolve(workspaceRoot)) {
        result.errors.push(`Invalid checkpoint ${snapshotId}`)
        return result
      }

      const recoveryDir = this.getRecoveryDir(parsed.data)
      for (const entry of parsed.data.entries) {
        if (!isPathWithinRoot(workspaceRoot, path.resolve(workspaceRoot, entry.relativePath), false)) {
          result.errors.push(`Path outside workspace: ${entry.relativePath}`)
          continue
        }
        const targetPath = path.resolve(workspaceRoot, entry.relativePath)
        try {
          if (entry.state === 'missing') {
            if (fs.existsSync(targetPath)) await fs.promises.rm(targetPath, { recursive: true, force: true })
          } else if (entry.state === 'directory') {
            await fs.promises.mkdir(targetPath, { recursive: true })
          } else {
            const backupPath = path.join(recoveryDir, backupFileName(entry.relativePath))
            const content = await fs.promises.readFile(backupPath, 'utf-8')
            await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
            await fs.promises.writeFile(targetPath, content, 'utf-8')
          }
          result.restoredCount++
        } catch (err: any) {
          result.errors.push(`Failed restoring ${entry.relativePath}: ${err.message}`)
        }
      }
    } catch (err: any) {
      result.errors.push(`Failed loading checkpoint ${snapshotId}: ${err.message}`)
    }

    return result
  }
}

export const sessionCheckpointRepository = new SessionCheckpointRepository()
