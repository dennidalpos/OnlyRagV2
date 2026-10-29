import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CodingSession } from '../../../../shared/types'
import { normalizeSession } from '../../domain/sessions/sessionHistoryDomain'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { sessionHistoryRepository } from './sessionHistoryRepository'
import { userDataSessionsDir } from './userDataRoot'

export interface SessionHistoryRecoveryRecord {
  version: 1
  recoveryId: string
  session: CodingSession
  sessionSha256: string
  baseSha256: string | null | 'unreadable'
  recordSha256: string
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function recordDigest(record: SessionHistoryRecoveryRecord): string {
  const { recordSha256: _hash, ...content } = record
  return digest(JSON.stringify(content))
}

function recoveryId(session: CodingSession): string {
  return digest(JSON.stringify([session.workspacePath, session.id]))
}

function normalized(session: CodingSession): CodingSession {
  const value = normalizeSession(session)
  if (!value) throw new Error('Invalid coding history recovery session')
  return value
}

export class SessionHistoryRecoveryJournal {
  constructor(private readonly root = path.join(userDataSessionsDir(), 'history-recovery')) {}

  hashSession(session: CodingSession): string {
    return digest(JSON.stringify(normalized(session)))
  }

  private file(recoveryId: string): string {
    if (!/^[0-9a-f]{64}$/.test(recoveryId)) throw new Error('Invalid coding history recovery identity')
    return path.join(this.root, `${recoveryId}.json`)
  }

  async read(recoveryId: string): Promise<SessionHistoryRecoveryRecord> {
    const file = this.file(recoveryId)
    if (!(await fs.promises.lstat(file)).isFile()) throw new Error('Unsupported coding history recovery entry')
    const raw = await fs.promises.readFile(file, 'utf8')
    const record = JSON.parse(raw) as SessionHistoryRecoveryRecord
    if (
      !record ||
      typeof record !== 'object' ||
      record.version !== 1 ||
      record.recoveryId !== recoveryId ||
      !record.session ||
      recoveryId !== recoveryIdForRecord(record) ||
      record.sessionSha256 !== digest(JSON.stringify(record.session)) ||
      record.recordSha256 !== recordDigest(record) ||
      (record.baseSha256 !== null && record.baseSha256 !== 'unreadable' && (typeof record.baseSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.baseSha256)))
    )
      throw new Error('Unsupported or corrupt coding history recovery record')
    normalized(record.session)
    return record
  }

  async list(): Promise<SessionHistoryRecoveryRecord[]> {
    let names: string[]
    try {
      if (!(await fs.promises.lstat(this.root)).isDirectory()) throw new Error('Unsupported coding history recovery directory')
      names = await fs.promises.readdir(this.root)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const records: SessionHistoryRecoveryRecord[] = []
    for (const name of names) {
      if (name.includes('.tmp-')) continue
      if (!/^[0-9a-f]{64}\.json$/.test(name)) throw new Error('Unsupported coding history recovery entry')
      records.push(await this.read(name.slice(0, -5)))
    }
    return records
  }

  async stage(session: CodingSession): Promise<SessionHistoryRecoveryRecord> {
    const snapshot = normalized(session)
    const id = recoveryId(snapshot)
    let existing: SessionHistoryRecoveryRecord | null = null
    try {
      existing = await this.read(id)
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    }
    let baseSha256: SessionHistoryRecoveryRecord['baseSha256'] = existing?.baseSha256 ?? null
    if (!existing) {
      try {
        const current = (await sessionHistoryRepository.listSessions(snapshot.workspacePath)).find((item) => item.id === snapshot.id)
        baseSha256 = current ? this.hashSession(current) : null
      } catch {
        baseSha256 = 'unreadable'
      }
    }
    const record: SessionHistoryRecoveryRecord = {
      version: 1,
      recoveryId: id,
      session: snapshot,
      sessionSha256: digest(JSON.stringify(snapshot)),
      baseSha256,
      recordSha256: '',
    }
    record.recordSha256 = recordDigest(record)
    await fs.promises.mkdir(this.root, { recursive: true })
    if (!(await fs.promises.lstat(this.root)).isDirectory()) throw new Error('Unsupported coding history recovery directory')
    await safeAtomicWrite(this.file(id), JSON.stringify(record))
    return this.read(id)
  }

  async acknowledge(session: CodingSession): Promise<void> {
    const snapshot = normalized(session)
    const id = recoveryId(snapshot)
    let record: SessionHistoryRecoveryRecord
    try {
      record = await this.read(id)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    const savedHash = digest(JSON.stringify(snapshot))
    if (record.sessionSha256 === savedHash) {
      await fs.promises.unlink(this.file(id))
      return
    }
    record.baseSha256 = savedHash
    record.recordSha256 = recordDigest(record)
    await safeAtomicWrite(this.file(id), JSON.stringify(record))
  }

  async removeDeleted(session: CodingSession): Promise<void> {
    const id = recoveryId(normalized(session))
    try {
      await this.read(id)
      await fs.promises.unlink(this.file(id))
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }

  async export(recoveryId: string, destinationDirectory: string): Promise<string> {
    const source = this.file(recoveryId)
    await this.read(recoveryId)
    const destination = path.resolve(destinationDirectory)
    if (!(await fs.promises.stat(destination)).isDirectory()) throw new Error('Recovery export destination is not a directory')
    const target = path.join(destination, `coding-history-recovery-${recoveryId}.json`)
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL)
    if (digest(await fs.promises.readFile(target, 'utf8')) !== digest(await fs.promises.readFile(source, 'utf8'))) {
      throw new Error('Coding history recovery export readback failed')
    }
    return target
  }

  async exportSnapshot(session: CodingSession, destinationDirectory: string): Promise<string> {
    const snapshot = normalized(session)
    const destination = path.resolve(destinationDirectory)
    if (!(await fs.promises.stat(destination)).isDirectory()) throw new Error('Recovery export destination is not a directory')
    const target = path.join(destination, `coding-history-snapshot-${randomUUID()}.json`)
    const content = JSON.stringify({ version: 1, session: snapshot, sessionSha256: digest(JSON.stringify(snapshot)) })
    await fs.promises.writeFile(target, content, { encoding: 'utf8', flag: 'wx', flush: true })
    if ((await fs.promises.readFile(target, 'utf8')) !== content) throw new Error('Coding history snapshot export readback failed')
    return target
  }
}

function recoveryIdForRecord(record: SessionHistoryRecoveryRecord): string {
  return recoveryId(record.session)
}

export const sessionHistoryRecoveryJournal = new SessionHistoryRecoveryJournal()
