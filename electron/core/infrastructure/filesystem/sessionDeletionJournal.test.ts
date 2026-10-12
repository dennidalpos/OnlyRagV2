import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionDeletionJournal } from './sessionDeletionJournal'
import { workspaceMetadataChildPath, workspaceMetadataSessionDirectory } from './workspaceMetadataDirectory'
import type { SessionHistoryCopy } from './sessionHistoryRepository'

const created: string[] = []

afterEach(() => {
  for (const root of created.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-deletion-journal-'))
  created.push(root)
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace)
  const sessionId = 'synthetic-recovery'
  const stateDir = workspaceMetadataSessionDirectory(workspace, sessionId)
  fs.mkdirSync(stateDir, { recursive: true })
  const state = JSON.stringify({ sessionId, workspacePath: workspace, marker: 'retained state' })
  fs.writeFileSync(path.join(stateDir, 'state.json'), state)
  fs.writeFileSync(path.join(stateDir, 'SESSION_TRACKER.md'), 'retained tracker')
  const checkpoint = path.join(workspaceMetadataChildPath(workspace, 'checkpoints'), 'checkpoint-1')
  fs.mkdirSync(checkpoint, { recursive: true })
  fs.writeFileSync(
    path.join(checkpoint, 'manifest.json'),
    JSON.stringify({
      version: 2,
      checkpointId: 'checkpoint-1',
      conversationId: sessionId,
      files: [],
    }),
  )
  fs.writeFileSync(path.join(checkpoint, '0.bin'), Buffer.from([0, 1, 2, 3]))
  const copies: SessionHistoryCopy[] = [
    {
      store: 'workspace',
      session: {
        id: sessionId,
        workspacePath: workspace,
        title: 'Retained',
        createdAt: '2026-10-12T00:00:00Z',
        updatedAt: '2026-10-12T00:00:00Z',
        actionLogs: [],
        executedPrompts: [
          {
            id: 'prompt-1',
            sessionId,
            prompt: 'Test',
            startedAt: '2026-10-12T00:00:00Z',
            agentMode: 'guided',
            outcome: 'success',
            totalSteps: 1,
            filesTouched: 0,
            additions: 0,
            deletions: 0,
            evidence: { checkpointId: 'checkpoint-1' } as never,
          },
        ],
      },
    },
  ]
  const journalRoot = path.join(root, 'journal')
  return { root, workspace, sessionId, stateDir, checkpoint, copies, journalRoot }
}

describe('retained session deletion journal', () => {
  it('fails closed when preparation was interrupted before the record existed', async () => {
    const data = fixture()
    fs.mkdirSync(path.join(data.journalRoot, randomUUID()), { recursive: true })
    await expect(new SessionDeletionJournal(data.journalRoot).list()).rejects.toThrow('ENOENT')
    expect(fs.readFileSync(path.join(data.stateDir, 'state.json'), 'utf-8')).toContain('retained state')
  })

  it('retains an interrupted preparation separately and reports it without deleting originals', async () => {
    const data = fixture()
    const preparation = path.join(data.journalRoot, `.preparing-${randomUUID()}`)
    fs.mkdirSync(preparation, { recursive: true })
    fs.writeFileSync(path.join(preparation, 'partial-copy'), 'retained')
    await expect(new SessionDeletionJournal(data.journalRoot).list()).rejects.toThrow('Incomplete deletion preparation retained')
    expect(fs.readFileSync(path.join(preparation, 'partial-copy'), 'utf-8')).toBe('retained')
    expect(fs.readFileSync(path.join(data.stateDir, 'state.json'), 'utf-8')).toContain('retained state')
  })

  it('binds copies and owned assets before deletion, then restores their exact bytes after restart', async () => {
    const data = fixture()
    const journal = new SessionDeletionJournal(data.journalRoot)
    const record = await journal.prepare(data.workspace, data.copies)
    expect(record.assets.map((asset) => asset.kind)).toEqual(['session-state', 'checkpoint'])
    expect(fs.readdirSync(data.journalRoot)).toEqual([record.operationId])
    expect((await new SessionDeletionJournal(data.journalRoot).list())[0].operationId).toBe(record.operationId)
    fs.rmSync(data.stateDir, { recursive: true })
    fs.rmSync(data.checkpoint, { recursive: true })
    await new SessionDeletionJournal(data.journalRoot).restoreAssets(record)
    expect(JSON.parse(fs.readFileSync(path.join(data.stateDir, 'state.json'), 'utf-8')).marker).toBe('retained state')
    expect(fs.readFileSync(path.join(data.checkpoint, '0.bin'))).toEqual(Buffer.from([0, 1, 2, 3]))
  })

  it('refuses corrupt retained bytes and does not restore them', async () => {
    const data = fixture()
    const journal = new SessionDeletionJournal(data.journalRoot)
    const record = await journal.prepare(data.workspace, data.copies)
    fs.writeFileSync(path.join(data.journalRoot, record.operationId, 'assets', '0', 'state.json'), 'changed')
    await expect(journal.read(record.operationId)).rejects.toThrow('Corrupt deletion recovery asset')
    await expect(journal.restoreAssets(record)).rejects.toThrow('Corrupt deletion recovery asset')
  })

  it('refuses a modified recovery manifest before dependent work', async () => {
    const data = fixture()
    const journal = new SessionDeletionJournal(data.journalRoot)
    const record = await journal.prepare(data.workspace, data.copies)
    const manifest = path.join(data.journalRoot, record.operationId, 'record.json')
    const changed = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as Record<string, unknown>
    changed.indexDeleted = true
    fs.writeFileSync(manifest, JSON.stringify(changed))
    await expect(journal.list()).rejects.toThrow('Unsupported or corrupt deletion recovery record')
  })

  it('refuses an ambiguous owner before creating a recovery operation', async () => {
    const data = fixture()
    const journal = new SessionDeletionJournal(data.journalRoot)
    const first = await journal.prepare(data.workspace, data.copies)
    await expect(journal.prepare(data.workspace, data.copies)).rejects.toThrow('already owns')
    expect((await journal.list()).map((record) => record.operationId)).toEqual([first.operationId])
  })

  it('refuses a changed state owner before any deletion and a newer asset during restore', async () => {
    const data = fixture()
    const journal = new SessionDeletionJournal(data.journalRoot)
    fs.writeFileSync(path.join(data.stateDir, 'state.json'), JSON.stringify({ sessionId: 'foreign', workspacePath: data.workspace }))
    await expect(journal.prepare(data.workspace, data.copies)).rejects.toThrow('different session owner')
    await expect(journal.list()).rejects.toThrow('Incomplete deletion preparation retained')
    expect(fs.readdirSync(data.journalRoot)).toHaveLength(1)
    fs.writeFileSync(path.join(data.stateDir, 'state.json'), JSON.stringify({ sessionId: data.sessionId, workspacePath: data.workspace }))
    const otherJournal = new SessionDeletionJournal(path.join(data.root, 'journal-after-refusal'))
    const record = await otherJournal.prepare(data.workspace, data.copies)
    fs.writeFileSync(path.join(data.stateDir, 'state.json'), 'newer state')
    await expect(otherJournal.restoreAssets(record)).rejects.toThrow('Newer recovery asset conflicts')
    expect(fs.readFileSync(path.join(data.stateDir, 'state.json'), 'utf-8')).toBe('newer state')
  })

  it('refuses state and checkpoint changes after preparation', async () => {
    const data = fixture()
    const journal = new SessionDeletionJournal(data.journalRoot)
    const record = await journal.prepare(data.workspace, data.copies)
    fs.writeFileSync(path.join(data.stateDir, 'SESSION_TRACKER.md'), 'newer tracker')
    await expect(journal.verifyDeletionAssets(record, data.sessionId)).rejects.toThrow('Changed recovery asset')
    fs.writeFileSync(path.join(data.stateDir, 'SESSION_TRACKER.md'), 'retained tracker')
    const newCheckpoint = path.join(path.dirname(data.checkpoint), 'checkpoint-2')
    fs.mkdirSync(newCheckpoint)
    fs.writeFileSync(
      path.join(newCheckpoint, 'manifest.json'),
      JSON.stringify({ version: 2, checkpointId: 'checkpoint-2', conversationId: data.sessionId, files: [] }),
    )
    await expect(journal.verifyDeletionAssets(record, data.sessionId)).rejects.toThrow('Newer checkpoint')
  })
})
