import { describe, expect, it } from 'vitest'
import {
  baselineSnapshotSchema,
  sessionManifestSchema,
} from './sessionBaselineContract'

const HASH = 'a'.repeat(64)
const TIMESTAMP = '2026-08-27T15:00:00.000Z'

describe('SessionManifest and BaselineSnapshot contracts', () => {
  it('accepts a dirty workspace manifest with nullable Git values', () => {
    const result = sessionManifestSchema.safeParse({
      schemaVersion: 1,
      sessionId: 'session-42',
      workspaceRoot: 'D:/projects/demo',
      startedAt: TIMESTAMP,
      workspaceClassification: 'existing',
      initialGit: {
        branch: 'master',
        commit: 'a'.repeat(40),
        isDirty: true,
        statusHash: HASH,
      },
      manifestHash: HASH,
      configHash: HASH,
    })

    expect(result.success).toBe(true)
  })

  it('accepts a baseline containing missing, file and directory states', () => {
    const result = baselineSnapshotSchema.safeParse({
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      sessionId: 'session-42',
      workspaceRoot: 'D:/projects/demo',
      capturedAt: TIMESTAMP,
      checkpoint: 0,
      entries: [
        { relativePath: 'src/app.ts', state: 'file', contentHash: HASH, sizeBytes: 120 },
        { relativePath: 'src', state: 'directory' },
        { relativePath: 'deleted.txt', state: 'missing' },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('rejects malformed hashes, timestamps, file metadata and unknown fields', () => {
    const manifest = sessionManifestSchema.safeParse({
      schemaVersion: 1,
      sessionId: 'session-42',
      workspaceRoot: 'D:/projects/demo',
      startedAt: 'not-a-timestamp',
      workspaceClassification: 'existing',
      initialGit: { branch: null, commit: null, isDirty: false, statusHash: null },
      manifestHash: 'short',
      configHash: HASH,
      unexpected: true,
    })
    const fileWithoutHash = baselineSnapshotSchema.safeParse({
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      sessionId: 'session-42',
      workspaceRoot: 'D:/projects/demo',
      capturedAt: TIMESTAMP,
      checkpoint: 1,
      entries: [{ relativePath: 'src/app.ts', state: 'file' }],
    })

    expect(manifest.success).toBe(false)
    expect(fileWithoutHash.success).toBe(false)
  })

  it('rejects file-only metadata on missing and directory entries', () => {
    const result = baselineSnapshotSchema.safeParse({
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      sessionId: 'session-42',
      workspaceRoot: 'D:/projects/demo',
      capturedAt: TIMESTAMP,
      checkpoint: 1,
      entries: [{ relativePath: 'src', state: 'directory', sizeBytes: 1 }],
    })

    expect(result.success).toBe(false)
  })
})
