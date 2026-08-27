import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { logger } from '../../../diagnostics'
import { baselineSnapshotSchema, type BaselineSnapshot } from '../../domain/sessions/sessionBaselineContract'
import { safeAtomicWrite } from './safeAtomicFileWriter'

const SNAPSHOT_FILE_PREFIX = '.baseline_snapshot_'
const SNAPSHOT_FILE_SUFFIX = '.json'

function safeSnapshotId(snapshotId: string): string {
  return snapshotId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export class BaselineSnapshotRepository {
  private getStorageDir(workspaceRoot: string): string {
    if (fs.existsSync(workspaceRoot)) {
      return path.join(workspaceRoot, '.onlyrag', 'sessions')
    }
    return path.join(os.homedir(), '.onlyrag_v2', 'sessions')
  }

  private getSnapshotPath(snapshotId: string, workspaceRoot: string): string {
    return path.join(this.getStorageDir(workspaceRoot), `${SNAPSHOT_FILE_PREFIX}${safeSnapshotId(snapshotId)}${SNAPSHOT_FILE_SUFFIX}`)
  }

  public async saveSnapshot(snapshot: BaselineSnapshot): Promise<boolean> {
    const parsed = baselineSnapshotSchema.safeParse(snapshot)
    if (!parsed.success) {
      logger.log('WARN', 'BaselineSnapshotRepo', `Rejected invalid snapshot ${snapshot?.snapshotId || 'unknown'}`)
      return false
    }

    try {
      const filePath = this.getSnapshotPath(parsed.data.snapshotId, parsed.data.workspaceRoot)
      return await safeAtomicWrite(filePath, JSON.stringify(parsed.data, null, 2))
    } catch (err: any) {
      logger.log('WARN', 'BaselineSnapshotRepo', `Failed saving snapshot ${parsed.data.snapshotId}: ${err.message}`)
      return false
    }
  }

  public async loadSnapshot(snapshotId: string, workspaceRoot: string): Promise<BaselineSnapshot | null> {
    try {
      const filePath = this.getSnapshotPath(snapshotId, workspaceRoot)
      if (!fs.existsSync(filePath)) return null
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const parsed = baselineSnapshotSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        logger.log('WARN', 'BaselineSnapshotRepo', `Rejected invalid persisted snapshot ${snapshotId}`)
        return null
      }
      return parsed.data
    } catch (err: any) {
      logger.log('WARN', 'BaselineSnapshotRepo', `Failed loading snapshot ${snapshotId}: ${err.message}`)
      return null
    }
  }

  public async clearSnapshot(snapshotId: string, workspaceRoot: string): Promise<boolean> {
    try {
      const filePath = this.getSnapshotPath(snapshotId, workspaceRoot)
      if (fs.existsSync(filePath)) await fs.promises.unlink(filePath)
      return true
    } catch (err: any) {
      logger.log('WARN', 'BaselineSnapshotRepo', `Failed clearing snapshot ${snapshotId}: ${err.message}`)
      return false
    }
  }
}

export const baselineSnapshotRepository = new BaselineSnapshotRepository()
