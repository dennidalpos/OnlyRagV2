import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ProjectRegistryRepository } from './projectRegistryRepository'

describe('ProjectRegistryRepository Unit Tests', () => {
  let tempDir: string
  let repo: ProjectRegistryRepository

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-project-registry-test-'))
    repo = new ProjectRegistryRepository(tempDir)
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should round-trip a registered project through an atomic write', async () => {
    const saved = await repo.upsert('/repo/a', 'Alpha')
    expect(saved.path).toBe('/repo/a')
    expect(saved.name).toBe('Alpha')
    expect(fs.existsSync(path.join(tempDir, 'project_registry.json'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'project_registry.json.tmp'))).toBe(false)

    const listed = await repo.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].path).toBe('/repo/a')
  })

  it('should preserve addedAt across repeated upserts of the same project', async () => {
    const first = await repo.upsert('/repo/a')
    const second = await repo.upsert('/repo/a')
    expect(second.addedAt).toBe(first.addedAt)
  })

  it('touch should bump lastOpenedAt for a known project and return null for an unknown one', async () => {
    await repo.upsert('/repo/a')
    const touched = await repo.touch('/repo/a')
    expect(touched).not.toBeNull()
    expect(await repo.touch('/repo/unknown')).toBeNull()

    // touch on an unknown project must not create it
    const listed = await repo.list()
    expect(listed.find((p) => p.path === '/repo/unknown')).toBeUndefined()
  })

  it('remove should delete a known project and no-op without throwing on an unknown one', async () => {
    await repo.upsert('/repo/a')
    expect(await repo.remove('/repo/a')).toBe(true)
    expect(await repo.list()).toHaveLength(0)
    expect(await repo.remove('/repo/never-existed')).toBe(false)
  })

  it('mergeLegacy should import projects not already in the registry, keeping the registry entry on conflict', async () => {
    await repo.upsert('/repo/a', 'Registry Name')
    const migrated = await repo.mergeLegacy([
      { path: '/repo/a', name: 'Legacy Name', addedAt: '2020-01-01T00:00:00.000Z' },
      { path: '/repo/b', name: 'Legacy B', addedAt: '2020-01-01T00:00:00.000Z' },
    ])
    expect(migrated).toBe(1)
    const listed = await repo.list()
    expect(listed).toHaveLength(2)
    expect(listed.find((p) => p.path === '/repo/a')?.name).toBe('Registry Name')
    expect(listed.find((p) => p.path === '/repo/b')?.name).toBe('Legacy B')
  })
})
