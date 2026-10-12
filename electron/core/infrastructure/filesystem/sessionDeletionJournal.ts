import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { agentSessionStateRepository } from './agentSessionStateRepository'
import { listConversationCheckpointPaths } from './agentCheckpointStore'
import type { SessionHistoryCopy } from './sessionHistoryRepository'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { userDataSessionsDir } from './userDataRoot'

type AssetKind = 'session-state' | 'fallback-state' | 'checkpoint'

interface RetainedFile {
  relativePath: string
  sha256: string
  bytes: number
}

interface RetainedAsset {
  kind: AssetKind
  sessionId: string
  checkpointId?: string
  singleFile: boolean
  files: RetainedFile[]
}

export interface SessionDeletionRecoveryRecord {
  version: 1
  operationId: string
  workspacePath: string | null
  sessionIds: string[]
  copies: SessionHistoryCopy[]
  copiesSha256: string
  recordSha256: string
  checkpointIds: Record<string, string[]>
  assets: RetainedAsset[]
  historyDeleted: boolean
  indexDeleted: boolean
  stateDeleted: string[]
  checkpointsDeleted: string[]
  status: 'pending' | 'restoring' | 'complete' | 'restored'
  error?: string
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function recordDigest(record: SessionDeletionRecoveryRecord): string {
  const { recordSha256: _digest, ...content } = record
  return sha256(JSON.stringify(content))
}

async function hashFile(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk)
    bytes += chunk.length
  }
  return { sha256: hash.digest('hex'), bytes }
}

function matchesWorkspace(actual: unknown, expected: string | null): boolean {
  if (actual == null) return expected === null
  return typeof actual === 'string' && expected !== null && path.normalize(actual).toLowerCase() === path.normalize(expected).toLowerCase()
}

function safeRelative(relative: string): boolean {
  return relative.length > 0 && !path.isAbsolute(relative) && !relative.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')
}

function assertDirectory(directory: string): void {
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Recovery asset directory is not a plain directory')
}

function assertPlainParents(target: string): void {
  const resolved = path.resolve(target)
  const root = path.parse(resolved).root
  let current = root
  for (const part of path.relative(root, path.dirname(resolved)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (!fs.lstatSync(current, { throwIfNoEntry: false })) break
    assertDirectory(current)
  }
  const file = fs.lstatSync(resolved, { throwIfNoEntry: false })
  if (file && (!file.isFile() || file.isSymbolicLink())) throw new Error('Recovery target is not a plain file')
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const stat = fs.lstatSync(root)
  if (stat.isSymbolicLink()) throw new Error('Linked recovery asset is refused')
  if (stat.isFile()) return ['file']
  assertDirectory(root)
  const files: string[] = []
  const visit = (directory: string, relative: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Unsupported recovery asset')
      const child = relative ? path.join(relative, entry.name) : entry.name
      if (entry.isDirectory()) visit(path.join(directory, entry.name), child)
      else files.push(child)
    }
  }
  visit(root, '')
  return files
}

/** Retains exact owned assets before any history, index, state or checkpoint deletion. */
export class SessionDeletionJournal {
  constructor(private readonly root = path.join(userDataSessionsDir(), 'deletion-recovery')) {}

  private operationDir(operationId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(operationId)) throw new Error('Invalid deletion operation identity')
    return path.join(this.root, operationId)
  }

  private preparationDir(operationId: string): string {
    this.operationDir(operationId)
    return path.join(this.root, `.preparing-${operationId}`)
  }

  private assetRoot(record: SessionDeletionRecoveryRecord, asset: RetainedAsset): string {
    if (!record.sessionIds.includes(asset.sessionId)) throw new Error('Recovery asset has an unrelated session')
    const paths = agentSessionStateRepository.sessionRecoveryPaths(asset.sessionId, record.workspacePath)
    if (asset.kind === 'session-state') {
      if (!record.workspacePath || paths.length < 2) throw new Error('Recovery workspace state is unavailable')
      return paths[0]
    }
    if (asset.kind === 'fallback-state') return paths[paths.length - 1]
    if (!record.workspacePath || !asset.checkpointId || !/^[A-Za-z0-9_-]{1,80}$/.test(asset.checkpointId)) {
      throw new Error('Invalid recovery checkpoint identity')
    }
    return path.join(path.resolve(record.workspacePath), '.onlyrag', 'checkpoints', asset.checkpointId)
  }

  private async retainAsset(record: SessionDeletionRecoveryRecord, asset: RetainedAsset, operationDirectory: string): Promise<void> {
    const source = this.assetRoot(record, asset)
    const index = record.assets.length
    const files = listFiles(source)
    if (files.length === 0) return
    const stateFile = asset.kind === 'fallback-state' ? source : asset.kind === 'session-state' ? path.join(source, 'state.json') : null
    if (stateFile && fs.existsSync(stateFile)) {
      const state = JSON.parse(await fs.promises.readFile(stateFile, 'utf-8')) as { sessionId?: unknown; workspacePath?: unknown }
      if (state.sessionId !== asset.sessionId || !matchesWorkspace(state.workspacePath, record.workspacePath)) {
        throw new Error('Recovery state has a different session owner')
      }
    }
    asset.singleFile = fs.lstatSync(source).isFile()
    for (const relativePath of files) {
      if (!safeRelative(relativePath)) throw new Error('Invalid recovery asset path')
      const original = asset.singleFile ? source : path.join(source, relativePath)
      const backup = path.join(operationDirectory, 'assets', String(index), relativePath)
      await fs.promises.mkdir(path.dirname(backup), { recursive: true })
      const before = await hashFile(original)
      await fs.promises.copyFile(original, backup, fs.constants.COPYFILE_EXCL)
      const after = await hashFile(backup)
      if (after.bytes !== before.bytes || after.sha256 !== before.sha256 || (await hashFile(original)).sha256 !== before.sha256)
        throw new Error('Recovery asset readback failed')
      asset.files.push({ relativePath, ...before })
    }
    record.assets.push(asset)
  }

  async prepare(workspacePath: string | null, copies: SessionHistoryCopy[]): Promise<SessionDeletionRecoveryRecord> {
    if (copies.length === 0) throw new Error('Deletion has no retained session copies')
    const sessionIds = [...new Set(copies.map((copy) => copy.session.id))]
    const pending = await this.list()
    if (pending.some((record) => (record.status === 'pending' || record.status === 'restoring') && record.sessionIds.some((id) => sessionIds.includes(id)))) {
      throw new Error('A retained deletion already owns this session')
    }
    const record: SessionDeletionRecoveryRecord = {
      version: 1,
      operationId: randomUUID(),
      workspacePath,
      sessionIds,
      copies,
      copiesSha256: sha256(JSON.stringify(copies)),
      recordSha256: '',
      checkpointIds: {},
      assets: [],
      historyDeleted: false,
      indexDeleted: false,
      stateDeleted: [],
      checkpointsDeleted: [],
      status: 'pending',
    }
    await fs.promises.mkdir(this.root, { recursive: true })
    const directory = this.preparationDir(record.operationId)
    await fs.promises.mkdir(directory)
    for (const sessionId of sessionIds) {
      const owned = copies.filter((copy) => copy.session.id === sessionId)
      const checkpointIds = [
        ...new Set(
          owned.flatMap((copy) => copy.session.executedPrompts?.map((prompt) => prompt.evidence?.checkpointId).filter((id): id is string => Boolean(id)) || []),
        ),
      ]
      record.checkpointIds[sessionId] = checkpointIds
      const statePaths = agentSessionStateRepository.sessionRecoveryPaths(sessionId, workspacePath)
      if (statePaths.length > 1) await this.retainAsset(record, { kind: 'session-state', sessionId, singleFile: false, files: [] }, directory)
      await this.retainAsset(record, { kind: 'fallback-state', sessionId, singleFile: true, files: [] }, directory)
      if (workspacePath) {
        for (const checkpoint of listConversationCheckpointPaths(workspacePath, sessionId, checkpointIds)) {
          await this.retainAsset(record, { kind: 'checkpoint', sessionId, checkpointId: path.basename(checkpoint), singleFile: false, files: [] }, directory)
        }
      }
    }
    record.recordSha256 = recordDigest(record)
    await safeAtomicWrite(path.join(directory, 'record.json'), JSON.stringify(record, null, 2))
    await this.readRecord(record.operationId, true, directory)
    await fs.promises.rename(directory, this.operationDir(record.operationId))
    return this.read(record.operationId)
  }

  private async readRecord(operationId: string, verifyAssets: boolean, directory = this.operationDir(operationId)): Promise<SessionDeletionRecoveryRecord> {
    assertDirectory(directory)
    const record = JSON.parse(await fs.promises.readFile(path.join(directory, 'record.json'), 'utf-8')) as SessionDeletionRecoveryRecord
    if (
      record.version !== 1 ||
      record.operationId !== operationId ||
      !Array.isArray(record.copies) ||
      (record.workspacePath !== null && (typeof record.workspacePath !== 'string' || !path.isAbsolute(record.workspacePath))) ||
      !Array.isArray(record.sessionIds) ||
      record.sessionIds.length === 0 ||
      record.sessionIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(record.sessionIds).size !== record.sessionIds.length ||
      !Array.isArray(record.assets) ||
      !['pending', 'restoring', 'complete', 'restored'].includes(record.status) ||
      !record.checkpointIds ||
      typeof record.checkpointIds !== 'object' ||
      record.copiesSha256 !== sha256(JSON.stringify(record.copies)) ||
      record.recordSha256 !== recordDigest(record) ||
      record.copies.some((copy) => !record.sessionIds.includes(copy.session?.id) || (copy.store !== 'workspace' && copy.store !== 'fallback'))
    ) {
      throw new Error('Unsupported or corrupt deletion recovery record')
    }
    for (const [index, asset] of record.assets.entries()) {
      if (!['session-state', 'fallback-state', 'checkpoint'].includes(asset.kind) || !Array.isArray(asset.files)) {
        throw new Error('Unsupported recovery asset')
      }
      this.assetRoot(record, asset)
      if (asset.singleFile !== (asset.kind === 'fallback-state')) throw new Error('Invalid recovery asset type')
      for (const file of asset.files) {
        if (!safeRelative(file.relativePath)) throw new Error('Unsafe deletion recovery asset path')
        const backup = path.join(directory, 'assets', String(index), file.relativePath)
        assertPlainParents(backup)
        if (verifyAssets) {
          const actual = await hashFile(backup)
          if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error('Corrupt deletion recovery asset')
        }
        if (asset.singleFile && file.relativePath !== 'file') throw new Error('Invalid retained file')
      }
    }
    return record
  }

  async read(operationId: string): Promise<SessionDeletionRecoveryRecord> {
    return this.readRecord(operationId, true)
  }

  async list(): Promise<SessionDeletionRecoveryRecord[]> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(this.root, { withFileTypes: true })
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) throw new Error('Unsupported deletion recovery entry')
      if (entry.name.startsWith('.preparing-')) throw new Error(`Incomplete deletion preparation retained: ${entry.name}`)
    }
    return Promise.all(entries.map((entry) => this.readRecord(entry.name, false)))
  }

  async update(record: SessionDeletionRecoveryRecord): Promise<SessionDeletionRecoveryRecord> {
    await this.read(record.operationId)
    record.recordSha256 = recordDigest(record)
    await safeAtomicWrite(path.join(this.operationDir(record.operationId), 'record.json'), JSON.stringify(record, null, 2))
    return this.read(record.operationId)
  }

  async verifyDeletionAssets(record: SessionDeletionRecoveryRecord, sessionId: string): Promise<void> {
    const verified = await this.read(record.operationId)
    const statePaths = agentSessionStateRepository.sessionRecoveryPaths(sessionId, verified.workspacePath)
    const retainedStateRoots = new Set(
      verified.assets.filter((asset) => asset.sessionId === sessionId && asset.kind !== 'checkpoint').map((asset) => this.assetRoot(verified, asset)),
    )
    if (statePaths.some((statePath) => !retainedStateRoots.has(statePath) && listFiles(statePath).length > 0)) {
      throw new Error('Newer session state conflicts with deletion')
    }
    for (const asset of verified.assets.filter((item) => item.sessionId === sessionId)) {
      const root = this.assetRoot(verified, asset)
      const actual = listFiles(root)
      const retained = new Map(asset.files.map((file) => [file.relativePath, file]))
      for (const relative of actual) {
        const file = retained.get(relative)
        if (!file) throw new Error('Newer recovery asset conflicts with deletion')
        const source = asset.singleFile ? root : path.join(root, relative)
        const digest = await hashFile(source)
        if (digest.bytes !== file.bytes || digest.sha256 !== file.sha256) {
          throw new Error('Changed recovery asset conflicts with deletion')
        }
      }
    }
    if (record.workspacePath) {
      const retained = new Set(
        verified.assets.filter((asset) => asset.sessionId === sessionId && asset.kind === 'checkpoint').map((asset) => asset.checkpointId),
      )
      const owned = listConversationCheckpointPaths(record.workspacePath, sessionId, record.checkpointIds[sessionId] || [])
      if (owned.some((checkpoint) => !retained.has(path.basename(checkpoint)))) {
        throw new Error('Newer checkpoint conflicts with deletion')
      }
    }
  }

  private async planAssetRestore(record: SessionDeletionRecoveryRecord): Promise<Array<{ target: string; backup: string }>> {
    const verified = await this.read(record.operationId)
    const missing: Array<{ target: string; backup: string }> = []
    for (const [index, asset] of verified.assets.entries()) {
      const root = this.assetRoot(verified, asset)
      for (const file of asset.files) {
        const target = asset.singleFile ? root : path.join(root, file.relativePath)
        const backup = path.join(this.operationDir(record.operationId), 'assets', String(index), file.relativePath)
        assertPlainParents(target)
        const existing = await hashFile(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (existing && (existing.bytes !== file.bytes || existing.sha256 !== file.sha256)) throw new Error('Newer recovery asset conflicts with restore')
        if (!existing) missing.push({ target, backup })
      }
    }
    return missing
  }

  async verifyRestoreAssets(record: SessionDeletionRecoveryRecord): Promise<void> {
    await this.planAssetRestore(record)
  }

  async restoreAssets(record: SessionDeletionRecoveryRecord): Promise<void> {
    for (const { target, backup } of await this.planAssetRestore(record)) {
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      const staging = `${target}.recovery-${randomUUID()}`
      await fs.promises.copyFile(backup, staging, fs.constants.COPYFILE_EXCL)
      try {
        const source = await hashFile(backup)
        const staged = await hashFile(staging)
        if (staged.bytes !== source.bytes || staged.sha256 !== source.sha256) throw new Error('Recovery staging readback failed')
        await fs.promises.link(staging, target)
      } finally {
        await fs.promises.unlink(staging)
      }
    }
  }

  async exportBundle(operationId: string, destinationDirectory: string): Promise<string> {
    const record = await this.read(operationId)
    const destination = path.resolve(destinationDirectory)
    assertDirectory(destination)
    const target = path.join(destination, `session-deletion-${operationId}`)
    if (fs.existsSync(target)) throw new Error('Recovery export already exists')
    await fs.promises.mkdir(target)
    const originalRecord = await fs.promises.readFile(path.join(this.operationDir(operationId), 'record.json'))
    await fs.promises.writeFile(path.join(target, 'record.json'), originalRecord)
    if (sha256(await fs.promises.readFile(path.join(target, 'record.json'))) !== sha256(originalRecord)) {
      throw new Error('Recovery export manifest readback failed')
    }
    for (const [index, asset] of record.assets.entries()) {
      for (const file of asset.files) {
        const source = path.join(this.operationDir(operationId), 'assets', String(index), file.relativePath)
        const destinationFile = path.join(target, 'assets', String(index), file.relativePath)
        await fs.promises.mkdir(path.dirname(destinationFile), { recursive: true })
        await fs.promises.copyFile(source, destinationFile)
        const actual = await hashFile(destinationFile)
        if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error('Recovery export readback failed')
      }
    }
    return target
  }
}

export const sessionDeletionJournal = new SessionDeletionJournal()
