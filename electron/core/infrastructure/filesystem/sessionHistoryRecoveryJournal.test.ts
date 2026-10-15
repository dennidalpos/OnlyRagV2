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
})
