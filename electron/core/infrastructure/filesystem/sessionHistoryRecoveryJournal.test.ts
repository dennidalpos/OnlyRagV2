import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodingSession } from '../../../../shared/types'

vi.mock('./sessionHistoryRepository', () => ({
  sessionHistoryRepository: { listSessions: vi.fn(async () => []) },
}))

import { sessionHistoryRepository } from './sessionHistoryRepository'
import { SessionHistoryRecoveryJournal } from './sessionHistoryRecoveryJournal'

const original: CodingSession = {
  id: 'session-1',
  workspacePath: 'C:/isolated',
  title: 'Original',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  actionLogs: [],
  executedPrompts: [],
  promptQueue: [],
}

describe('coding history recovery journal', () => {
  let root: string
  let journal: SessionHistoryRecoveryJournal

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'onlyrag-history-recovery-test-'))
    journal = new SessionHistoryRecoveryJournal(root)
    vi.mocked(sessionHistoryRepository.listSessions).mockReset().mockResolvedValue([original])
  })

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true })
  })

  it('retains the newest staged revision until that exact revision is saved', async () => {
    const firstLog = { id: 'first', timestamp: '2026-10-15T00:00:00.000Z', type: 'info' as const, message: 'First' }
    const first = { ...original, actionLogs: [firstLog] }
    const latest = { ...first, actionLogs: [firstLog, { ...firstLog, id: 'latest', message: 'Latest' }] }
    const staged = await journal.stage(first)
    expect(staged.baseSha256).toBe(journal.hashSession(original))
    await journal.stage(latest)
    await journal.acknowledge(first)
    expect((await journal.read(staged.recoveryId)).session.actionLogs).toHaveLength(2)
    expect((await journal.read(staged.recoveryId)).baseSha256).toBe(journal.hashSession(first))
    await journal.acknowledge(latest)
    expect(await journal.list()).toEqual([])
  })

  it('rejects a corrupt record and exports an intact retained snapshot with independent readback', async () => {
    const staged = await journal.stage({ ...original, title: 'Unsaved' })
    const exportDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'onlyrag-history-export-test-'))
    try {
      const exported = await journal.export(staged.recoveryId, exportDir)
      expect(JSON.parse(await fs.promises.readFile(exported, 'utf8')).session.title).toBe('Unsaved')
      await fs.promises.writeFile(path.join(root, `${staged.recoveryId}.json`), '{"version":1}')
      await expect(journal.read(staged.recoveryId)).rejects.toThrow('corrupt')
    } finally {
      await fs.promises.rm(exportDir, { recursive: true, force: true })
    }
  })

  it('preserves an unreadable canonical baseline across later staging attempts', async () => {
    vi.mocked(sessionHistoryRepository.listSessions).mockRejectedValueOnce(new Error('store unavailable'))
    const staged = await journal.stage({ ...original, title: 'First unsaved revision' })
    expect(staged.baseSha256).toBe('unreadable')
    expect((await journal.stage({ ...original, title: 'Second unsaved revision' })).baseSha256).toBe('unreadable')
    expect((await journal.read(staged.recoveryId)).session.title).toBe('Second unsaved revision')
    expect(sessionHistoryRepository.listSessions).toHaveBeenCalledTimes(1)
  })

  it('refuses a modified snapshot in read and list without acknowledging or removing it', async () => {
    const staged = await journal.stage({ ...original, title: 'Unsaved' })
    const file = path.join(root, `${staged.recoveryId}.json`)
    await fs.promises.writeFile(file, JSON.stringify({ ...staged, session: { ...staged.session, title: 'Tampered' } }))
    await expect(journal.read(staged.recoveryId)).rejects.toThrow('corrupt')
    await expect(journal.list()).rejects.toThrow('corrupt')
    await expect(journal.acknowledge(original)).rejects.toThrow('corrupt')
    expect(await fs.promises.readFile(file, 'utf8')).toContain('Tampered')
  })

  it('refuses invalid or occupied export targets without changing the staged snapshot', async () => {
    const staged = await journal.stage({ ...original, title: 'Unsaved' })
    const exportDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'onlyrag-history-export-test-'))
    try {
      await expect(journal.export('../outside', exportDir)).rejects.toThrow('Invalid coding history recovery identity')
      await expect(journal.export(staged.recoveryId, path.join(exportDir, 'missing'))).rejects.toThrow()
      const target = path.join(exportDir, `coding-history-recovery-${staged.recoveryId}.json`)
      await fs.promises.writeFile(target, 'existing export')
      await expect(journal.export(staged.recoveryId, exportDir)).rejects.toThrow()
      expect(await fs.promises.readFile(target, 'utf8')).toBe('existing export')
      expect((await journal.read(staged.recoveryId)).session.title).toBe('Unsaved')
    } finally {
      await fs.promises.rm(exportDir, { recursive: true, force: true })
    }
  })
})
