import fs from 'node:fs'
import { workspaceMetadataChildPath } from './workspaceMetadataDirectory'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ArtifactRecord, ArtifactSaveInput } from '../../../../shared/types'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { errorCode, errorMessage } from '../../../../shared/domain/errors/errorMessage'

const ARTIFACT_ID = /^[a-zA-Z0-9_-]{1,128}$/
const ARTIFACT_KINDS = new Set<string>(['html', 'svg', 'markdown'])

/** Raised when an existing artifact record cannot be decoded; the original bytes are never touched in that state. */
export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactStoreError'
  }
}

export class ArtifactRepository {
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
  private async read(filePath: string, expectedWorkspacePath: string): Promise<ArtifactRecord | null> {
    let raw: string
    try {
      raw = await fs.promises.readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if (errorCode(err) === 'ENOENT') return null
      throw new ArtifactStoreError(`Artifact record is unreadable and was left unchanged (${path.basename(filePath)}): ${errorMessage(err)}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err: unknown) {
      throw new ArtifactStoreError(`Artifact record is not valid JSON and was left unchanged (${path.basename(filePath)}): ${errorMessage(err)}`)
    }
    const record = this.decode(parsed, filePath, expectedWorkspacePath)
    if (!record) throw new ArtifactStoreError(`Artifact record is incomplete or inconsistent and was left unchanged (${path.basename(filePath)})`)
    return record
  }

  private decode(value: unknown, filePath: string, expectedWorkspacePath: string): ArtifactRecord | null {
    if (!value || typeof value !== 'object') return null
    const r = value as Record<string, unknown>
    if (typeof r.id !== 'string' || !ARTIFACT_ID.test(r.id) || `${r.id}.json` !== path.basename(filePath)) return null
    if (typeof r.workspacePath !== 'string' || path.resolve(r.workspacePath).toLowerCase() !== path.resolve(expectedWorkspacePath).toLowerCase()) return null
    if (typeof r.name !== 'string' || typeof r.content !== 'string') return null
    if (typeof r.kind !== 'string' || !ARTIFACT_KINDS.has(r.kind)) return null
    if (typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string') return null
    return r as unknown as ArtifactRecord
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
    const filePath = this.getFilePath(workspacePath, id)
    if (!fs.existsSync(filePath)) return false
    await fs.promises.rm(filePath)
    return true
  }
}

export const artifactRepository = new ArtifactRepository()
