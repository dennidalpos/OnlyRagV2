import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ArtifactRecord, ArtifactSaveInput } from '../../../../shared/types'
import { safeAtomicWrite } from './safeAtomicFileWriter'

const ARTIFACT_ID = /^[a-zA-Z0-9_-]{1,128}$/

export class ArtifactRepository {
  private getDirectory(workspacePath: string): string {
    if (!workspacePath || !path.isAbsolute(workspacePath)) throw new Error('Workspace path must be absolute')
    if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) throw new Error('Workspace does not exist')
    return path.join(workspacePath, '.onlyrag', 'artifacts')
  }

  private getFilePath(workspacePath: string, id: string): string {
    if (!ARTIFACT_ID.test(id)) throw new Error('Invalid artifact id')
    const directory = this.getDirectory(workspacePath)
    const filePath = path.resolve(directory, `${id}.json`)
    if (path.dirname(filePath) !== path.resolve(directory)) throw new Error('Artifact path escapes workspace')
    return filePath
  }

  private async read(filePath: string): Promise<ArtifactRecord | null> {
    if (!fs.existsSync(filePath)) return null
    try {
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as ArtifactRecord
      if (!parsed || typeof parsed.id !== 'string' || !ARTIFACT_ID.test(parsed.id) || typeof parsed.content !== 'string') return null
      return parsed
    } catch {
      return null
    }
  }

  async list(workspacePath: string): Promise<ArtifactRecord[]> {
    const directory = this.getDirectory(workspacePath)
    if (!fs.existsSync(directory)) return []
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    const records = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => this.read(path.join(directory, entry.name))))
    return records.filter((record): record is ArtifactRecord => record !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(workspacePath: string, id: string): Promise<ArtifactRecord | null> {
    return this.read(this.getFilePath(workspacePath, id))
  }

  async save(workspacePath: string, input: ArtifactSaveInput): Promise<ArtifactRecord> {
    const id = input.id || crypto.randomUUID()
    const filePath = this.getFilePath(workspacePath, id)
    const previous = await this.read(filePath)
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
    if (!await safeAtomicWrite(filePath, JSON.stringify(record, null, 2))) throw new Error('Could not persist artifact')
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
