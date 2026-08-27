import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sessionCheckpointRepository } from './sessionCheckpointRepository'
import type { BaselineSnapshot } from '../../domain/sessions/sessionBaselineContract'

function makeSnapshot(workspaceRoot: string): BaselineSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: 'checkpoint-1',
    sessionId: 'session-42',
    workspaceRoot,
    capturedAt: '2026-08-27T15:00:00.000Z',
    checkpoint: 1,
    entries: [
      { relativePath: 'preexisting.txt', state: 'file', contentHash: 'd'.repeat(64), sizeBytes: 8 },
      { relativePath: 'created.txt', state: 'missing' },
      { relativePath: 'generated', state: 'directory' },
    ],
  }
}

describe('SessionCheckpointRepository', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-checkpoint-'))
    fs.writeFileSync(path.join(workspaceRoot, 'preexisting.txt'), 'before\n', 'utf-8')
    fs.writeFileSync(path.join(workspaceRoot, 'created.txt'), 'created by session\n', 'utf-8')
    fs.mkdirSync(path.join(workspaceRoot, 'generated'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('saves a checkpoint and recovers only the files declared by that session', async () => {
    const snapshot = makeSnapshot(workspaceRoot)
    expect(await sessionCheckpointRepository.saveCheckpoint(snapshot, [{ relativePath: 'preexisting.txt', originalContent: 'before\n' }])).toBe(true)

    fs.writeFileSync(path.join(workspaceRoot, 'preexisting.txt'), 'changed by session\n', 'utf-8')
    fs.writeFileSync(path.join(workspaceRoot, 'created.txt'), 'changed again\n', 'utf-8')
    fs.writeFileSync(path.join(workspaceRoot, 'unrelated.txt'), 'preexisting work\n', 'utf-8')
    fs.rmSync(path.join(workspaceRoot, 'generated'), { recursive: true, force: true })

    const result = await sessionCheckpointRepository.recoverSession(snapshot.snapshotId, workspaceRoot)
    expect(result).toEqual({ restoredCount: 3, errors: [] })
    expect(fs.readFileSync(path.join(workspaceRoot, 'preexisting.txt'), 'utf-8')).toBe('before\n')
    expect(fs.existsSync(path.join(workspaceRoot, 'created.txt'))).toBe(false)
    expect(fs.existsSync(path.join(workspaceRoot, 'generated'))).toBe(true)
    expect(fs.readFileSync(path.join(workspaceRoot, 'unrelated.txt'), 'utf-8')).toBe('preexisting work\n')
  })

  it('is idempotent when the same checkpoint is saved and recovered repeatedly', async () => {
    const snapshot = makeSnapshot(workspaceRoot)
    const backups = [{ relativePath: 'preexisting.txt', originalContent: 'before\n' }]
    expect(await sessionCheckpointRepository.saveCheckpoint(snapshot, backups)).toBe(true)
    expect(await sessionCheckpointRepository.saveCheckpoint(snapshot, backups)).toBe(true)

    fs.writeFileSync(path.join(workspaceRoot, 'preexisting.txt'), 'changed\n', 'utf-8')
    expect((await sessionCheckpointRepository.recoverSession(snapshot.snapshotId, workspaceRoot)).errors).toEqual([])
    expect((await sessionCheckpointRepository.recoverSession(snapshot.snapshotId, workspaceRoot)).errors).toEqual([])
    expect(fs.readFileSync(path.join(workspaceRoot, 'preexisting.txt'), 'utf-8')).toBe('before\n')
  })

  it('rejects a file entry without a durable backup', async () => {
    expect(await sessionCheckpointRepository.saveCheckpoint(makeSnapshot(workspaceRoot))).toBe(false)
    expect(fs.existsSync(path.join(workspaceRoot, '.onlyrag'))).toBe(false)
  })

  it('rejects backup paths outside the workspace', async () => {
    const snapshot = makeSnapshot(workspaceRoot)
    expect(await sessionCheckpointRepository.saveCheckpoint(snapshot, [{ relativePath: '../outside.txt', originalContent: 'secret' }])).toBe(false)
  })
})
