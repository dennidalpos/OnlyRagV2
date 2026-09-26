import fs from 'node:fs'
import { ensureWorkspaceMetadataDirectory } from './workspaceMetadataDirectory'
import path from 'node:path'
import { isPathWithinRoot } from '../../domain/agent/pathContainment'
import type { FileBackupEntry } from './atomicWorkspaceJournal'
import { validateWorkspaceRealpath } from './workspaceRealpathGuard'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

/** Checkpoints kept per workspace; older ones are pruned when a new one is saved. */
const MAX_CHECKPOINTS = 10

interface CheckpointManifest {
  version: 1
  checkpointId: string
  createdAt: string
  /** Workspace-relative paths with their pre-run state: a blob file name, or null for a file the run created. */
  files: { path: string; blob: string | null }[]
}

export interface CheckpointRestoreResult {
  success: boolean
  restoredCount: number
  errors: string[]
}

function checkpointsRoot(workspacePath: string): string {
  return path.join(workspacePath, '.onlyrag', 'checkpoints')
}

function safeCheckpointId(checkpointId: string): string | null {
  return /^[A-Za-z0-9_-]{1,80}$/.test(checkpointId) ? checkpointId : null
}

function pruneOldCheckpoints(root: string): void {
  try {
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, mtime: fs.statSync(path.join(root, entry.name)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)
    for (const stale of entries.slice(MAX_CHECKPOINTS)) fs.rmSync(path.join(root, stale.name), { recursive: true, force: true })
  } catch (error: unknown) {
    logger.log('WARN', 'AgentCheckpointStore', `Checkpoint pruning skipped: ${errorMessage(error)}`)
  }
}

/**
 * Persists a run's pre-change file states inside the workspace, so the user can undo the run later,
 * after a restart too. Timeouts and cancellations keep the agent's work on disk (the journal used to
 * roll everything back) and this checkpoint is how the user returns to the state before the run.
 * Only files inside the workspace are recorded. Returns null when the run changed no file.
 */
export function saveAgentCheckpoint(workspacePath: string, checkpointId: string, baseline: ReadonlyMap<string, FileBackupEntry>): string | null {
  const id = safeCheckpointId(checkpointId)
  if (!id || baseline.size === 0) return null
  const root = path.resolve(workspacePath)
  const directory = path.join(checkpointsRoot(root), id)
  try {
    ensureWorkspaceMetadataDirectory(root)
    fs.mkdirSync(directory, { recursive: true })
    const files: CheckpointManifest['files'] = []
    let blobIndex = 0
    for (const [absolute, entry] of baseline) {
      const resolved = path.resolve(absolute)
      if (!isPathWithinRoot(root, resolved)) continue
      const relative = path.relative(root, resolved).replace(/\\/g, '/')
      if (relative.startsWith('.onlyrag/')) continue
      if (entry.originalContent === null) {
        files.push({ path: relative, blob: null })
        continue
      }
      const blob = `${blobIndex++}.bin`
      fs.writeFileSync(path.join(directory, blob), entry.originalContent)
      files.push({ path: relative, blob })
    }
    if (files.length === 0) {
      fs.rmSync(directory, { recursive: true, force: true })
      return null
    }
    const manifest: CheckpointManifest = { version: 1, checkpointId: id, createdAt: new Date().toISOString(), files }
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    pruneOldCheckpoints(checkpointsRoot(root))
    return id
  } catch (error: unknown) {
    logger.log('ERROR', 'AgentCheckpointStore', `Checkpoint ${id} not saved: ${errorMessage(error)}`)
    return null
  }
}

/** Returns every file a checkpoint recorded to its pre-run state; files the run created are removed. */
export function restoreAgentCheckpoint(workspacePath: string, checkpointId: string): CheckpointRestoreResult {
  const id = safeCheckpointId(checkpointId)
  if (!id) return { success: false, restoredCount: 0, errors: ['Invalid checkpoint id.'] }
  const root = path.resolve(workspacePath)
  const directory = path.join(checkpointsRoot(root), id)
  let manifest: CheckpointManifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf-8')) as CheckpointManifest
  } catch (error: unknown) {
    return { success: false, restoredCount: 0, errors: [`Checkpoint not found: ${errorMessage(error)}`] }
  }

  const errors: string[] = []
  let restoredCount = 0
  for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
    // The manifest lives in the workspace, so it is validated like any untrusted path.
    const check = typeof file?.path === 'string' ? validateWorkspaceRealpath(file.path, root) : { safePath: null, error: 'Invalid entry' }
    if (!check.safePath || (file.blob !== null && !/^\d+\.bin$/.test(String(file.blob)))) {
      errors.push(`Skipped ${String(file?.path)}: ${check.error || 'invalid blob reference'}`)
      continue
    }
    try {
      if (file.blob === null) {
        if (fs.existsSync(check.safePath) && fs.statSync(check.safePath).isFile()) fs.unlinkSync(check.safePath)
      } else {
        fs.mkdirSync(path.dirname(check.safePath), { recursive: true })
        fs.writeFileSync(check.safePath, fs.readFileSync(path.join(directory, file.blob)))
      }
      restoredCount++
    } catch (error: unknown) {
      errors.push(`Failed restoring ${file.path}: ${errorMessage(error)}`)
    }
  }
  return { success: errors.length === 0, restoredCount, errors }
}
