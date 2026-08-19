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
 * Manages transactional workspace file snapshots and safe rollbacks, at both session
 * granularity (rollbackAll) and single-step granularity (rollbackLastStep).
 */
export class AtomicWorkspaceJournal {
  /** Session-wide baseline: first-ever snapshot of each file touched this session. */
  private backupMap = new Map<string, FileBackupEntry>()
  /** Pre-step snapshots accumulated since the last endStep() call. */
  private currentStepBackup = new Map<string, FileBackupEntry>()
  /** Snapshot of the most recently ENDED step, ready for rollbackLastStep(). Null once rolled back or after a session-wide reset. */
  private lastStepBackup: Map<string, FileBackupEntry> | null = null

  /**
   * Records initial state of target file prior to any mutating operation, both against the
   * session-wide baseline (if not already tracked this session) and the current step's
   * baseline (if not already tracked this step).
   */
  public recordBeforeModification(filePath: string): void {
    if (!filePath || typeof filePath !== 'string') return
    const resolved = path.resolve(filePath)
    this.snapshotInto(this.backupMap, resolved)
    this.snapshotInto(this.currentStepBackup, resolved)
  }

  private snapshotInto(map: Map<string, FileBackupEntry>, resolved: string): void {
    if (map.has(resolved)) {
      return // Keep the baseline already captured for this window intact
    }
    try {
      if (fs.existsSync(resolved)) {
        const st = fs.statSync(resolved)
        if (st.isFile()) {
          const content = fs.readFileSync(resolved, 'utf-8')
          map.set(resolved, { originalContent: content, modifiedTimestamp: Date.now() })
        }
      } else {
        map.set(resolved, { originalContent: null, modifiedTimestamp: Date.now() })
      }
    } catch (err: any) {
      logger.log('WARN', 'AtomicWorkspaceJournal', `Could not snapshot ${resolved}: ${err.message}`)
    }
  }

  /**
   * Marks the end of the current agent step: whatever was snapshotted since the previous
   * endStep() call becomes the undoable "last step" (even if empty, meaning that step touched
   * no files), and a fresh step baseline starts accumulating. Callers invoke this once per
   * loop iteration, right after that iteration's tool call finishes.
   */
  public endStep(): void {
    this.lastStepBackup = this.currentStepBackup
    this.currentStepBackup = new Map()
  }

  private restoreEntries(entries: Map<string, FileBackupEntry>): RollbackResult {
    let restoredCount = 0
    const errors: string[] = []

    for (const [filePath, entry] of entries.entries()) {
      try {
        if (entry.originalContent === null) {
          if (fs.existsSync(filePath)) {
            const st = fs.statSync(filePath)
            if (st.isDirectory()) {
              fs.rmSync(filePath, { recursive: true, force: true })
            } else {
              fs.unlinkSync(filePath)
            }
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

    return { restoredCount, errors }
  }

  /**
   * Restores all modified files to their pre-task state and removes newly created files.
   */
  public rollbackAll(): RollbackResult {
    const result = this.restoreEntries(this.backupMap)
    this.backupMap.clear()
    this.currentStepBackup.clear()
    this.lastStepBackup = null
    return result
  }

  /**
   * Restores only the files touched during the most recently ended step, leaving every
   * earlier step's changes (and the rest of the session) untouched. A no-op (0 restored,
   * no errors) when the last step touched no files, or there is no ended step to undo yet.
   * Consumes the last-step snapshot: a second call without an intervening endStep() is a no-op.
   */
  public rollbackLastStep(): RollbackResult {
    if (!this.lastStepBackup || this.lastStepBackup.size === 0) {
      return { restoredCount: 0, errors: [] }
    }
    const result = this.restoreEntries(this.lastStepBackup)
    this.lastStepBackup = null
    return result
  }

  /** Whether rollbackLastStep() has a non-empty step snapshot to restore right now. */
  public get canRollbackLastStep(): boolean {
    return Boolean(this.lastStepBackup && this.lastStepBackup.size > 0)
  }

  /**
   * Commits the workspace state by clearing snapshots on successful task completion.
   */
  public commit(): number {
    const count = this.backupMap.size
    this.backupMap.clear()
    this.currentStepBackup.clear()
    this.lastStepBackup = null
    return count
  }

  /**
   * Returns the count of tracked modified files in current journal (session-wide baseline).
   */
  public get trackedCount(): number {
    return this.backupMap.size
  }
}
