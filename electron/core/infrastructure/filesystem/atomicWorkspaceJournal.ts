import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../../../diagnostics'

export interface FileBackupEntry {
  originalContent: string | null // null if file was newly created during the session
  modifiedTimestamp: number
}

export interface RollbackResult {
  restoredCount: number
  errors: string[]
}

/**
 * Manages transactional workspace file snapshots and safe rollbacks.
 */
export class AtomicWorkspaceJournal {
  private backupMap = new Map<string, FileBackupEntry>()

  /**
   * Records initial state of target file prior to any mutating operation.
   * If already tracked in current session, original snapshot is preserved.
   */
  public recordBeforeModification(filePath: string): void {
    if (!filePath || typeof filePath !== 'string') return
    const resolved = path.resolve(filePath)

    if (this.backupMap.has(resolved)) {
      return // Keep initial baseline snapshot intact
    }

    try {
      if (fs.existsSync(resolved)) {
        const content = fs.readFileSync(resolved, 'utf-8')
        this.backupMap.set(resolved, {
          originalContent: content,
          modifiedTimestamp: Date.now(),
        })
      } else {
        this.backupMap.set(resolved, {
          originalContent: null,
          modifiedTimestamp: Date.now(),
        })
      }
    } catch (err: any) {
      logger.log('WARN', 'AtomicWorkspaceJournal', `Could not snapshot ${filePath}: ${err.message}`)
    }
  }

  /**
   * Restores all modified files to their pre-task state and removes newly created files.
   */
  public rollbackAll(): RollbackResult {
    let restoredCount = 0
    const errors: string[] = []

    for (const [filePath, entry] of this.backupMap.entries()) {
      try {
        if (entry.originalContent === null) {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
          }
        } else {
          const parentDir = path.dirname(filePath)
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true })
          }
          fs.writeFileSync(filePath, entry.originalContent, 'utf-8')
        }
        restoredCount++
      } catch (err: any) {
        const errMsg = `Failed restoring ${filePath}: ${err.message}`
        logger.log('ERROR', 'AtomicWorkspaceJournal', errMsg)
        errors.push(errMsg)
      }
    }

    this.backupMap.clear()
    return { restoredCount, errors }
  }

  /**
   * Commits the workspace state by clearing snapshots on successful task completion.
   */
  public commit(): number {
    const count = this.backupMap.size
    this.backupMap.clear()
    return count
  }

  /**
   * Returns the count of tracked modified files in current journal.
   */
  public get trackedCount(): number {
    return this.backupMap.size
  }
}
