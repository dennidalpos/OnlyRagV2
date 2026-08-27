import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sessionManifestRepository, SessionManifestRepository } from './sessionManifestRepository'
import type { SessionManifest } from '../../domain/sessions/sessionBaselineContract'

const HASH = 'b'.repeat(64)

function makeManifest(workspaceRoot: string, sessionId = 'session-42'): SessionManifest {
  return {
    schemaVersion: 1,
    sessionId,
    workspaceRoot,
    startedAt: '2026-08-27T15:00:00.000Z',
    workspaceClassification: 'existing',
    initialGit: {
      branch: 'master',
      commit: 'b'.repeat(40),
      isDirty: true,
      statusHash: HASH,
    },
    manifestHash: HASH,
    configHash: HASH,
  }
}

describe('SessionManifestRepository', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-session-manifest-'))
  })

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('persists and reloads a validated manifest atomically in the workspace session store', async () => {
    const manifest = makeManifest(workspaceRoot)

    expect(await sessionManifestRepository.saveManifest(manifest)).toBe(true)
    expect(await sessionManifestRepository.loadManifest(manifest.sessionId, workspaceRoot)).toEqual(manifest)

    const storedPath = path.join(workspaceRoot, '.onlyrag', 'sessions', '.session_manifest_session-42.json')
    expect(fs.existsSync(storedPath)).toBe(true)
    expect(fs.readdirSync(path.dirname(storedPath)).some((entry) => entry.includes('.tmp-'))).toBe(false)
  })

  it('serializes concurrent writes to the same session without leaving partial files', async () => {
    const repository = new SessionManifestRepository()
    const first = makeManifest(workspaceRoot)
    const second = makeManifest(workspaceRoot)
    second.configHash = 'c'.repeat(64)

    await expect(Promise.all([
      repository.saveManifest(first),
      repository.saveManifest(second),
    ])).resolves.toEqual([true, true])

    const loaded = await repository.loadManifest(first.sessionId, workspaceRoot)
    expect(loaded?.configHash).toBe(second.configHash)
  })

  it('rejects invalid manifests before creating a file', async () => {
    const invalid = { ...makeManifest(workspaceRoot), configHash: 'not-a-hash' } as unknown as SessionManifest

    expect(await sessionManifestRepository.saveManifest(invalid)).toBe(false)
    expect(fs.existsSync(path.join(workspaceRoot, '.onlyrag'))).toBe(false)
  })

  it('returns null for corrupted or schema-invalid persisted content', async () => {
    const manifest = makeManifest(workspaceRoot)
    const manifestPath = path.join(workspaceRoot, '.onlyrag', 'sessions', '.session_manifest_session-42.json')
    await sessionManifestRepository.saveManifest(manifest)
    fs.writeFileSync(manifestPath, '{"schemaVersion":1,"sessionId":"session-42"}', 'utf-8')

    expect(await sessionManifestRepository.loadManifest(manifest.sessionId, workspaceRoot)).toBeNull()
  })
})
