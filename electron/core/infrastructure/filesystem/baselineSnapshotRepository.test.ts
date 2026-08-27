import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { baselineSnapshotRepository, BaselineSnapshotRepository } from './baselineSnapshotRepository'
import type { BaselineSnapshot } from '../../domain/sessions/sessionBaselineContract'

const HASH = 'c'.repeat(64)

function makeSnapshot(workspaceRoot: string, snapshotId = 'snapshot-1'): BaselineSnapshot {
  return {
    schemaVersion: 1,
    snapshotId,
    sessionId: 'session-42',
    workspaceRoot,
    capturedAt: '2026-08-27T15:00:00.000Z',
    checkpoint: 0,
    entries: [
      { relativePath: 'src/app.ts', state: 'file', contentHash: HASH, sizeBytes: 128 },
      { relativePath: 'src', state: 'directory' },
      { relativePath: 'removed.txt', state: 'missing' },
    ],
  }
}

describe('BaselineSnapshotRepository', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-baseline-snapshot-'))
  })

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('persists and reloads a snapshot in the session store', async () => {
    const snapshot = makeSnapshot(workspaceRoot)

    expect(await baselineSnapshotRepository.saveSnapshot(snapshot)).toBe(true)
    expect(await baselineSnapshotRepository.loadSnapshot(snapshot.snapshotId, workspaceRoot)).toEqual(snapshot)

    const storedPath = path.join(workspaceRoot, '.onlyrag', 'sessions', '.baseline_snapshot_snapshot-1.json')
    expect(fs.existsSync(storedPath)).toBe(true)
    expect(fs.existsSync(path.join(workspaceRoot, '.onlyrag', 'sessions', '.session_manifest_snapshot-1.json'))).toBe(false)
  })

  it('serializes concurrent writes to the same snapshot atomically', async () => {
    const repository = new BaselineSnapshotRepository()
    const first = makeSnapshot(workspaceRoot)
    const second = makeSnapshot(workspaceRoot)
    second.checkpoint = 1

    await expect(Promise.all([
      repository.saveSnapshot(first),
      repository.saveSnapshot(second),
    ])).resolves.toEqual([true, true])

    const loaded = await repository.loadSnapshot(first.snapshotId, workspaceRoot)
    expect(loaded?.checkpoint).toBe(second.checkpoint)
    expect(fs.readdirSync(path.join(workspaceRoot, '.onlyrag', 'sessions')).some((entry) => entry.includes('.tmp-'))).toBe(false)
  })

  it('rejects invalid snapshots before creating storage', async () => {
    const invalid = { ...makeSnapshot(workspaceRoot), entries: [{ relativePath: 'src/app.ts', state: 'file' }] } as unknown as BaselineSnapshot

    expect(await baselineSnapshotRepository.saveSnapshot(invalid)).toBe(false)
    expect(fs.existsSync(path.join(workspaceRoot, '.onlyrag'))).toBe(false)
  })

  it('returns null for malformed persisted JSON and supports clearing', async () => {
    const snapshot = makeSnapshot(workspaceRoot)
    const snapshotPath = path.join(workspaceRoot, '.onlyrag', 'sessions', '.baseline_snapshot_snapshot-1.json')
    await baselineSnapshotRepository.saveSnapshot(snapshot)
    fs.writeFileSync(snapshotPath, '{malformed', 'utf-8')

    expect(await baselineSnapshotRepository.loadSnapshot(snapshot.snapshotId, workspaceRoot)).toBeNull()
    expect(await baselineSnapshotRepository.clearSnapshot(snapshot.snapshotId, workspaceRoot)).toBe(true)
    expect(fs.existsSync(snapshotPath)).toBe(false)
  })
})
