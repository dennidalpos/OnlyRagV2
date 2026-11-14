import fs from 'node:fs'
import { workspaceMetadataChildPath } from './workspaceMetadataDirectory'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ArtifactInspection, ArtifactRecord, ArtifactSaveInput } from '../../../../shared/types'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { errorCode, errorMessage } from '../../../../shared/domain/errors/errorMessage'

const ARTIFACT_ID = /^[a-zA-Z0-9_-]{1,128}$/
const ARTIFACT_KINDS = new Set<string>(['html', 'svg', 'markdown'])

function workspaceKey(workspacePath: string): string {
  const resolved = path.resolve(workspacePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function digest(bytes: string | Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

interface StoredArtifact {
  record: ArtifactRecord
  hash: string
}

/** Raised when an existing artifact record cannot be decoded; the original bytes are never touched in that state. */
export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactStoreError'
  }
}

export class ArtifactRepository {
  private pendingWrite = Promise.resolve()

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingWrite.then(operation)
    this.pendingWrite = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private getDirectory(workspacePath: string): string {
    if (!workspacePath || !path.isAbsolute(workspacePath)) throw new Error('Workspace path must be absolute')
    if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) throw new Error('Workspace does not exist')
    return workspaceMetadataChildPath(workspacePath, 'artifacts')
  }

  private getFilePath(workspacePath: string, id: string): string {
    if (!ARTIFACT_ID.test(id)) throw new Error('Invalid artifact id')
    const directory = this.getDirectory(workspacePath)
    const filePath = path.resolve(directory, `${id}.json`)
    if (path.dirname(filePath) !== path.resolve(directory)) throw new Error('Artifact path escapes workspace')
    return filePath
  }

  /** Absent file is `null`; an existing but unreadable or invalid record is an error and is never replaced. */
  private async readBytes(filePath: string): Promise<Buffer | null> {
    try {
      const stat = await fs.promises.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular file')
      return await fs.promises.readFile(filePath)
    } catch (err: unknown) {
      if (errorCode(err) === 'ENOENT') return null
      throw new ArtifactStoreError(`Artifact record is unreadable and was left unchanged (${path.basename(filePath)}): ${errorMessage(err)}`)
    }
  }

  private decodeBytes(raw: Buffer, filePath: string): ArtifactRecord {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw))
    } catch (err: unknown) {
      throw new ArtifactStoreError(`Artifact record is not valid JSON and was left unchanged (${path.basename(filePath)}): ${errorMessage(err)}`)
    }
    const record = this.decode(parsed, filePath)
    if (!record) throw new ArtifactStoreError(`Artifact record is incomplete or inconsistent and was left unchanged (${path.basename(filePath)})`)
    return record
  }

  private async read(filePath: string, workspacePath: string): Promise<ArtifactRecord | null> {
    const raw = await this.readBytes(filePath)
    if (!raw) return null
    const record = this.decodeBytes(raw, filePath)
    if (workspaceKey(record.workspacePath) !== workspaceKey(workspacePath)) {
      throw new ArtifactStoreError(`Artifact record belongs to another workspace (${path.basename(filePath)})`)
    }
    return record
  }

  private decode(value: unknown, filePath: string): ArtifactRecord | null {
    if (!value || typeof value !== 'object') return null
    const r = value as Record<string, unknown>
    if (typeof r.id !== 'string' || !ARTIFACT_ID.test(r.id) || `${r.id}.json` !== path.basename(filePath)) return null
    if (typeof r.workspacePath !== 'string' || !path.isAbsolute(r.workspacePath)) return null
    if (typeof r.name !== 'string' || typeof r.content !== 'string') return null
    if (typeof r.kind !== 'string' || !ARTIFACT_KINDS.has(r.kind)) return null
    if (typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string') return null
    return r as unknown as ArtifactRecord
  }

  private async scan(workspacePath: string) {
    const directory = this.getDirectory(workspacePath)
    const current: ArtifactRecord[] = []
    const groups = new Map<string, StoredArtifact[]>()
    const rejected: ArtifactInspection['rejected'] = []
    const entries = fs.existsSync(directory) ? await fs.promises.readdir(directory, { withFileTypes: true }) : []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -5)
      const filePath = path.join(directory, entry.name)
      let raw: Buffer | null = null
      try {
        if (!entry.isFile()) throw new ArtifactStoreError('Expected a regular artifact file')
        raw = await this.readBytes(filePath)
        if (!raw) continue
        const record = this.decodeBytes(raw, filePath)
        const key = workspaceKey(record.workspacePath)
        if (key === workspaceKey(workspacePath)) {
          current.push(record)
        } else {
          const group = groups.get(key) ?? []
          group.push({ record, hash: digest(raw) })
          groups.set(key, group)
        }
      } catch (err: unknown) {
        rejected.push({ fileName: entry.name, message: errorMessage(err), exportId: raw && ARTIFACT_ID.test(id) ? id : undefined })
      }
    }
    current.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { current, groups, rejected }
  }

  private groupRevision(group: StoredArtifact[]): string {
    return digest(JSON.stringify(group.map(({ record, hash }) => [record.id, hash])))
  }

  async inspect(workspacePath: string): Promise<ArtifactInspection> {
    const { current, groups, rejected } = await this.scan(workspacePath)
    return {
      records: current,
      rejected,
      moved: [...groups.values()].map((group) => ({
        previousWorkspacePath: group[0].record.workspacePath,
        count: group.length,
        revision: this.groupRevision(group),
      })),
    }
  }

  async rebind(workspacePath: string, previousWorkspacePath: string, revision: string): Promise<void> {
    if (!path.isAbsolute(previousWorkspacePath)) throw new Error('Previous workspace path must be absolute')
    return this.write(async () => {
      const { groups } = await this.scan(workspacePath)
      const group = groups.get(workspaceKey(previousWorkspacePath))
      if (!group || this.groupRevision(group) !== revision) {
        throw new ArtifactStoreError('Artifacts changed since review. Refresh and confirm the current records.')
      }
      for (const { record, hash } of group) {
        const filePath = this.getFilePath(workspacePath, record.id)
        const raw = await this.readBytes(filePath)
        if (!raw || digest(raw) !== hash) throw new ArtifactStoreError('Artifact changed during recovery. Refresh to review the remaining records.')
        const serialized = JSON.stringify({ ...record, workspacePath }, null, 2)
        await safeAtomicWrite(filePath, serialized)
        if (!(await this.readBytes(filePath))?.equals(Buffer.from(serialized))) {
          throw new ArtifactStoreError('Artifact recovery could not be confirmed. Refresh to review the remaining records.')
        }
      }
    })
  }

  async exportRejected(workspacePath: string, artifactId: string, destination: string): Promise<void> {
    const filePath = this.getFilePath(workspacePath, artifactId)
    const raw = await this.readBytes(filePath)
    if (!raw) throw new ArtifactStoreError('Artifact no longer exists')
    try {
      this.decodeBytes(raw, filePath)
    } catch (err: unknown) {
      if (!(err instanceof ArtifactStoreError)) throw err
      await fs.promises.writeFile(destination, raw, { flag: 'wx', flush: true })
      return
    }
    throw new ArtifactStoreError('Artifact is no longer rejected. Refresh the list.')
  }

  async list(workspacePath: string): Promise<ArtifactRecord[]> {
    const directory = this.getDirectory(workspacePath)
    if (!fs.existsSync(directory)) return []
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    const records = await Promise.all(
      entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => this.read(path.join(directory, entry.name), workspacePath)),
    )
    return records.filter((record): record is ArtifactRecord => record !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(workspacePath: string, id: string): Promise<ArtifactRecord | null> {
    return this.read(this.getFilePath(workspacePath, id), workspacePath)
  }

  async save(workspacePath: string, input: ArtifactSaveInput): Promise<ArtifactRecord> {
    return this.write(() => this.saveRecord(workspacePath, input))
  }

  private async saveRecord(workspacePath: string, input: ArtifactSaveInput): Promise<ArtifactRecord> {
    const id = input.id || crypto.randomUUID()
    const filePath = this.getFilePath(workspacePath, id)
    const previous = await this.read(filePath, workspacePath)
    const now = new Date().toISOString()
    const record: ArtifactRecord = {
      id,
      workspacePath,
      name: input.name.trim(),
      kind: input.kind,
      content: input.content,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    const serialized = JSON.stringify(record, null, 2)
    if (!(await safeAtomicWrite(filePath, serialized))) throw new Error('Could not persist artifact')
    if ((await fs.promises.readFile(filePath, 'utf-8')) !== serialized) throw new ArtifactStoreError('Artifact write could not be confirmed by readback')
    return record
  }

  async delete(workspacePath: string, id: string): Promise<boolean> {
    return this.write(async () => {
      const filePath = this.getFilePath(workspacePath, id)
      if (!(await this.read(filePath, workspacePath))) return false
      await fs.promises.rm(filePath)
      return true
    })
  }
}

export const artifactRepository = new ArtifactRepository()
