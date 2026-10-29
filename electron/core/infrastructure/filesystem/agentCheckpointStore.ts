import fs from 'node:fs'
import { workspaceMetadataChildPath } from './workspaceMetadataDirectory'
import path from 'node:path'
import { isPathWithinRoot } from '../../domain/agent/pathContainment'
import type { FileBackupEntry } from './atomicWorkspaceJournal'
import { validateWorkspaceRealpath } from './workspaceRealpathGuard'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

/** Checkpoints kept per workspace; older ones are pruned when a new one is saved. */
const MAX_CHECKPOINTS = 10

interface CheckpointManifest {
  version: 1 | 2
  checkpointId: string
  conversationId?: string
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
  return workspaceMetadataChildPath(workspacePath, 'checkpoints')
}

function safeCheckpointId(checkpointId: string): string | null {
  return /^[A-Za-z0-9_-]{1,80}$/.test(checkpointId) ? checkpointId : null
}

function checkpointRelativePath(workspacePath: string, absolute: string): string | null {
  const root = path.resolve(workspacePath)
  const resolved = path.resolve(absolute)
  if (!isPathWithinRoot(root, resolved)) return null
  const relative = path.relative(root, resolved).replace(/\\/g, '/')
  return relative.toLowerCase().startsWith('.onlyrag/') ? null : relative
}

export function hasAgentCheckpointBaseline(workspacePath: string, baseline: ReadonlyMap<string, FileBackupEntry>): boolean {
  return [...baseline.keys()].some((absolute) => checkpointRelativePath(workspacePath, absolute) !== null)
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
export function saveAgentCheckpoint(
  workspacePath: string,
  checkpointId: string,
  baseline: ReadonlyMap<string, FileBackupEntry>,
  conversationId?: string,
): string | null {
  const id = safeCheckpointId(checkpointId)
  if (!id) return null
  const root = path.resolve(workspacePath)
  const directory = path.join(checkpointsRoot(root), id)
  if (baseline.size === 0 && !fs.existsSync(path.join(directory, 'manifest.json'))) return null
  try {
    if (fs.existsSync(directory) && (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()))
      throw new Error('Unsafe checkpoint directory')
    fs.mkdirSync(directory, { recursive: true })
    const manifestPath = path.join(directory, 'manifest.json')
    const previous: CheckpointManifest | null = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null
    if (previous && (previous.version !== 2 || previous.checkpointId !== id || previous.conversationId !== conversationId || !Array.isArray(previous.files))) {
      throw new Error('Retained checkpoint has a different or invalid owner')
    }
    const files: CheckpointManifest['files'] = previous ? [...previous.files] : []
    for (const file of files) {
      if (typeof file?.path !== 'string' || (file.blob !== null && !/^\d+\.bin$/.test(file.blob))) throw new Error('Invalid retained checkpoint entry')
      if (file.blob !== null) fs.readFileSync(path.join(directory, file.blob))
    }
    const retainedPaths = new Set(files.map((file) => file.path.toLowerCase()))
    let blobIndex =
      1 +
      Math.max(
        -1,
        ...fs
          .readdirSync(directory)
          .filter((name) => /^\d+\.bin$/.test(name))
          .map((name) => Number.parseInt(name)),
      )
    for (const [absolute, entry] of baseline) {
      const relative = checkpointRelativePath(root, absolute)
      if (relative === null) continue
      // A resumed run keeps the first pre-change bytes, including files it created before the crash.
      if (retainedPaths.has(relative.toLowerCase())) continue
      if (entry.originalContent === null) {
        files.push({ path: relative, blob: null })
        continue
      }
      const blob = `${blobIndex++}.bin`
      fs.writeFileSync(path.join(directory, blob), entry.originalContent, { flag: 'wx', flush: true })
      files.push({ path: relative, blob })
    }
    if (files.length === 0) {
      fs.rmSync(directory, { recursive: true, force: true })
      return null
    }
    if (previous && files.length === previous.files.length) return id
    const manifest: CheckpointManifest = { version: 2, checkpointId: id, conversationId, createdAt: previous?.createdAt || new Date().toISOString(), files }
    const staging = path.join(directory, `manifest-${process.pid}.tmp`)
    try {
      fs.writeFileSync(staging, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flush: true })
      fs.renameSync(staging, manifestPath)
    } finally {
      if (fs.existsSync(staging)) fs.unlinkSync(staging)
    }
    pruneOldCheckpoints(checkpointsRoot(root))
    return id
  } catch (error: unknown) {
    logger.log('ERROR', 'AgentCheckpointStore', `Checkpoint ${id} not saved: ${errorMessage(error)}`)
    return null
  }
}

/** Finds checkpoints owned by a conversation, including referenced v1 checkpoints. */
export function listConversationCheckpointPaths(workspacePath: string, conversationId: string, referencedIds: readonly string[]): string[] {
  const root = checkpointsRoot(workspacePath)
  if (!fs.existsSync(root)) return []
  const referenced = new Set(referencedIds)
  const owned: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !safeCheckpointId(entry.name)) continue
    const directory = path.join(root, entry.name)
    let manifest: CheckpointManifest
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf-8')) as CheckpointManifest
    } catch (error: unknown) {
      if (referenced.has(entry.name)) throw new Error(`Referenced checkpoint ownership unavailable for ${entry.name}: ${errorMessage(error)}`)
      logger.log('WARN', 'AgentCheckpointStore', `Checkpoint ownership unavailable for ${entry.name}: ${errorMessage(error)}`)
      continue
    }
    if (referenced.has(entry.name)) {
      if (manifest.version !== 1 && (manifest.version !== 2 || manifest.conversationId !== conversationId)) {
        throw new Error(`Referenced checkpoint has a different or unsupported owner: ${entry.name}`)
      }
      owned.push(directory)
      continue
    }
    if (manifest.version === 2 && manifest.conversationId === conversationId) owned.push(directory)
  }
  return owned
}

/** Removes checkpoints owned by a deleted conversation, including referenced v1 checkpoints. */
export function deleteConversationCheckpoints(workspacePath: string, conversationId: string, referencedIds: readonly string[]): void {
  for (const directory of listConversationCheckpointPaths(workspacePath, conversationId, referencedIds)) {
    fs.rmSync(directory, { recursive: true, force: true })
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
    const internal =
      check.safePath &&
      path
        .relative(root, check.safePath)
        .split(path.sep)
        .some((segment) => segment.toLowerCase() === '.onlyrag')
    if (!check.safePath || internal || (file.blob !== null && !/^\d+\.bin$/.test(String(file.blob)))) {
      errors.push(`Skipped ${String(file?.path)}: ${internal ? 'application-owned metadata' : check.error || 'invalid blob reference'}`)
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
