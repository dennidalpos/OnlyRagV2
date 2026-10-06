import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ProjectRegistryRepository } from './projectRegistryRepository'
import * as writer from './safeAtomicFileWriter'

describe('ProjectRegistryRepository Unit Tests', () => {
  let tempDir: string
  let repo: ProjectRegistryRepository

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-project-registry-test-'))
    repo = new ProjectRegistryRepository(tempDir)
  })

  it.each(['{broken', '{"version":99,"projects":[]}', '{"version":1}', '{"version":1,"projects":[{"path":"/kept","name":"Kept"},null]}'])(
    'preserves unreadable or unsupported registry: %s',
    async (raw) => {
      const file = path.join(tempDir, 'project_registry.json')
      fs.writeFileSync(file, raw)
      await expect(repo.list()).rejects.toThrow()
      await expect(repo.upsert('/new')).rejects.toThrow()
      await expect(repo.remove('/kept')).rejects.toThrow()
      expect(fs.readFileSync(file, 'utf8')).toBe(raw)
    },
  )

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('retains concurrent registrations across repositories sharing the same store', async () => {
    const other = new ProjectRegistryRepository(tempDir)
    await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? repo : other).upsert(`/repo/${index}`)))
    expect((await repo.list()).map((project) => project.path).sort()).toEqual(Array.from({ length: 12 }, (_, index) => `/repo/${index}`).sort())
  })

  it('serializes mixed rename, touch, remove and registration without losing unrelated entries', async () => {
    for (const name of ['a', 'b', 'c']) await repo.upsert(`/repo/${name}`)
    await Promise.all([repo.rename('/repo/a', 'Renamed'), repo.touch('/repo/b'), repo.remove('/repo/c'), repo.upsert('/repo/d')])
    const projects = await repo.list()
    expect(projects.map((project) => project.path).sort()).toEqual(['/repo/a', '/repo/b', '/repo/d'])
    expect(projects.find((project) => project.path === '/repo/a')?.name).toBe('Renamed')
  })

  it.each(['upsert', 'touch', 'rename', 'remove'] as const)('rejects an unacknowledged %s and allows an explicit retry', async (operation) => {
    await repo.upsert('/repo/a', 'Alpha')
    const file = path.join(tempDir, 'project_registry.json')
    const original = fs.readFileSync(file, 'utf8')
    const blocked = vi.spyOn(writer, 'safeAtomicWrite').mockResolvedValue(false)
    const mutate = () => (operation === 'rename' ? repo.rename('/repo/a', 'New name') : repo[operation]('/repo/a'))
    await expect(mutate()).rejects.toThrow('saved')
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    blocked.mockRestore()
    await expect(mutate()).resolves.toBeTruthy()
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

  it('rejects duplicate retained paths before a mutation collapses them', async () => {
    const retained = await repo.upsert('/duplicate')
    const file = path.join(tempDir, 'project_registry.json')
    const raw = JSON.stringify({ version: 1, projects: [retained, retained] })
    fs.writeFileSync(file, raw)
    await expect(repo.upsert('/new')).rejects.toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe(raw)
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
})
