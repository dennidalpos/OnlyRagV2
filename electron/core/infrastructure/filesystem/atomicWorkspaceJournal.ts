import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

export interface FileBackupEntry {
  /** Bytes before the first change; null if the file was created during the session. Buffers keep binary files intact. */
  originalContent: Buffer | string | null
  modifiedTimestamp: number
}

/** Files snapshotted when a whole directory is about to be deleted; beyond it the change is refused, never journalled in part. */
const MAX_DIRECTORY_SNAPSHOT_FILES = 2000

/** The original state could not be captured completely; the change must not proceed. */
export class JournalSnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalSnapshotError'
  }
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
  /** Last completed step snapshot, if available for rollback. */
  private lastStepBackup: Map<string, FileBackupEntry> | null = null

  /** Records the file in the session and current-step baselines. */
  public recordBeforeModification(filePath: string): void {
    if (!filePath || typeof filePath !== 'string') return
    const resolved = path.resolve(filePath)
    this.snapshotInto(this.backupMap, resolved)
    this.snapshotInto(this.currentStepBackup, resolved)
  }

  public recordOriginalState(filePath: string, originalContent: string | null): void {
    if (!filePath || typeof filePath !== 'string') return
    const resolved = path.resolve(filePath)
    this.recordEntry(this.backupMap, resolved, originalContent)
    this.recordEntry(this.currentStepBackup, resolved, originalContent)
  }

  private recordEntry(map: Map<string, FileBackupEntry>, resolved: string, originalContent: string | null): void {
    if (!map.has(resolved)) map.set(resolved, { originalContent, modifiedTimestamp: Date.now() })
  }

  /**
   * Captures the pre-change state of a path into the map. All-or-nothing: if any original cannot be captured
   * completely (unreadable file, symlink or special entry under a directory, more files than the limit) it
   * throws JournalSnapshotError and leaves the map untouched, so the caller can refuse before mutating.
   */
  private snapshotInto(map: Map<string, FileBackupEntry>, resolved: string): void {
    if (map.has(resolved)) {
      return // Keep the baseline already captured for this window intact
    }
    try {
      const staged = new Map<string, FileBackupEntry>()
      if (fs.existsSync(resolved)) {
        const st = fs.statSync(resolved)
        if (st.isFile()) {
          staged.set(resolved, { originalContent: fs.readFileSync(resolved), modifiedTimestamp: Date.now() })
        } else if (st.isDirectory()) {
          // A directory about to be deleted: every file under it is part of the baseline, so the
          // deletion can be undone file by file.
          this.snapshotDirectoryInto(staged, map, resolved)
        } else {
          throw new Error('not a regular file or directory')
        }
      } else {
        staged.set(resolved, { originalContent: null, modifiedTimestamp: Date.now() })
      }
      for (const [key, entry] of staged) if (!map.has(key)) map.set(key, entry)
    } catch (err: unknown) {
      const message = `Snapshot of ${resolved} is incomplete, so the change was refused: ${errorMessage(err)}`
      logger.log('WARN', 'AtomicWorkspaceJournal', message)
      throw new JournalSnapshotError(message)
    }
  }

  private snapshotDirectoryInto(staged: Map<string, FileBackupEntry>, existing: Map<string, FileBackupEntry>, directory: string): void {
    const pending = [directory]
    let files = 0
    while (pending.length > 0) {
      const current = pending.pop() as string
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name)
        if (entry.isSymbolicLink()) throw new Error(`${full} is a symbolic link`)
        if (entry.isDirectory()) {
          pending.push(full)
        } else if (entry.isFile()) {
          if (existing.has(full)) continue
          if (++files > MAX_DIRECTORY_SNAPSHOT_FILES) throw new Error(`more than ${MAX_DIRECTORY_SNAPSHOT_FILES} files`)
          staged.set(full, { originalContent: fs.readFileSync(full), modifiedTimestamp: Date.now() })
        } else {
          throw new Error(`${full} is not a regular file`)
        }
      }
    }
  }

  /** The session baseline, for a persistent checkpoint (see agentCheckpointStore.ts). */
  public get sessionBaseline(): ReadonlyMap<string, FileBackupEntry> {
    return this.backupMap
  }

  /** Marks the end of the current agent step: whatever was snapshotted since the previous endStep() call becomes the undoable "last step" (even if empty, meaning that step touched no files), and a fresh step baseline starts accumulating. */
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
          fs.writeFileSync(filePath, entry.originalContent)
          const written = fs.readFileSync(filePath)
          if (!written.equals(Buffer.from(entry.originalContent))) throw new Error('restored bytes differ from the original')
        }
        restoredCount++
      } catch (err: unknown) {
        const errMsg = `Failed restoring ${filePath}: ${errorMessage(err)}`
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

  /** Restores only the files touched during the most recently ended step, leaving every earlier step's changes (and the rest of the session) untouched. */
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

  /** Absolute paths mutated since the last commit or rollback boundary. */
  public get trackedPaths(): string[] {
    return Array.from(this.backupMap.keys())
  }
}
