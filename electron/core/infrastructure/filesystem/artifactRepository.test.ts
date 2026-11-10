import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactRepository, ArtifactStoreError } from './artifactRepository'

let workspacePath: string | undefined
const repository = new ArtifactRepository()

afterEach(() => {
  vi.restoreAllMocks()
  if (workspacePath) fs.rmSync(workspacePath, { recursive: true, force: true })
  workspacePath = undefined
})

function workspace(): string {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-artifacts-'))
  return workspacePath
}

describe('ArtifactRepository', () => {
  it('saves, lists and updates artifacts in the workspace metadata directory', async () => {
    const root = workspace()
    const created = await repository.save(root, { name: 'Demo', kind: 'html', content: '<h1>one</h1>' })
    const updated = await repository.save(root, { id: created.id, name: 'Demo 2', kind: 'svg', content: '<svg />' })

    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(await repository.get(root, created.id)).toEqual(updated)
    expect(await repository.list(root)).toEqual([updated])
    expect(fs.existsSync(path.join(root, '.onlyrag', 'artifacts', `${created.id}.json`))).toBe(true)
  })

  it('deletes an existing artifact and reports a missing id as false', async () => {
    const root = workspace()
    const created = await repository.save(root, { name: 'Demo', kind: 'markdown', content: '# Demo' })

    expect(await repository.delete(root, created.id)).toBe(true)
    expect(await repository.get(root, created.id)).toBeNull()
    expect(await repository.delete(root, created.id)).toBe(false)
  })

  it('rejects relative workspaces and traversal-shaped artifact ids', async () => {
    await expect(repository.list('relative-workspace')).rejects.toThrow('absolute')
    const root = workspace()
    await expect(repository.get(root, '../escape')).rejects.toThrow('Invalid artifact id')
  })

  describe('existing unreadable or invalid records', () => {
    const artifactFile = (root: string, id: string) => path.join(root, '.onlyrag', 'artifacts', `${id}.json`)
    const plant = (root: string, id: string, bytes: string) => {
      fs.mkdirSync(path.dirname(artifactFile(root, id)), { recursive: true })
      fs.writeFileSync(artifactFile(root, id), bytes, 'utf-8')
    }
    const full = { name: 'n', kind: 'html', content: 'x', createdAt: 'a', updatedAt: 'b' }

    it('rejects get, list and save on a truncated record and preserves its bytes', async () => {
      const root = workspace()
      const created = await repository.save(root, { name: 'Demo', kind: 'html', content: '<p>x</p>' })
      const truncated = fs.readFileSync(artifactFile(root, created.id), 'utf-8').slice(0, 40)
      fs.writeFileSync(artifactFile(root, created.id), truncated, 'utf-8')

      await expect(repository.get(root, created.id)).rejects.toBeInstanceOf(ArtifactStoreError)
      await expect(repository.list(root)).rejects.toBeInstanceOf(ArtifactStoreError)
      await expect(repository.save(root, { id: created.id, name: 'New', kind: 'html', content: 'new' })).rejects.toBeInstanceOf(ArtifactStoreError)
      expect(fs.readFileSync(artifactFile(root, created.id), 'utf-8')).toBe(truncated)
    })

    it.each([
      ['incomplete record', (id: string, ws: string) => JSON.stringify({ id, workspacePath: ws, content: 'x' })],
      ['unknown kind', (id: string, ws: string) => JSON.stringify({ id, workspacePath: ws, ...full, kind: 'exe' })],
      ['id differing from file name', (_id: string, ws: string) => JSON.stringify({ id: 'other', workspacePath: ws, ...full })],
      ['record of another workspace', (id: string) => JSON.stringify({ id, workspacePath: path.join(os.tmpdir(), 'elsewhere'), ...full })],
    ])('rejects %s without rewriting it', async (_label, build) => {
      const root = workspace()
      const bytes = build('fixture', root)
      plant(root, 'fixture', bytes)
      await expect(repository.get(root, 'fixture')).rejects.toBeInstanceOf(ArtifactStoreError)
      await expect(repository.save(root, { id: 'fixture', name: 'n', kind: 'html', content: 'y' })).rejects.toBeInstanceOf(ArtifactStoreError)
      expect(fs.readFileSync(artifactFile(root, 'fixture'), 'utf-8')).toBe(bytes)
    })

    it('reports an unreadable record as an error and recovers after repair', async () => {
      const root = workspace()
      fs.mkdirSync(artifactFile(root, 'dirrecord'), { recursive: true })
      await expect(repository.get(root, 'dirrecord')).rejects.toBeInstanceOf(ArtifactStoreError)
      fs.rmSync(artifactFile(root, 'dirrecord'), { recursive: true })
      expect(await repository.get(root, 'dirrecord')).toBeNull()
      const saved = await repository.save(root, { id: 'dirrecord', name: 'ok', kind: 'svg', content: '<svg/>' })
      expect(await repository.get(root, 'dirrecord')).toEqual(saved)
    })

    it('keeps the previous record when the rename fails and retry succeeds', async () => {
      const root = workspace()
      const created = await repository.save(root, { name: 'Demo', kind: 'html', content: 'one' })
      const before = fs.readFileSync(artifactFile(root, created.id), 'utf-8')
      const spy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
      await expect(repository.save(root, { id: created.id, name: 'Demo', kind: 'html', content: 'two' })).rejects.toThrow('disk full')
      expect(fs.readFileSync(artifactFile(root, created.id), 'utf-8')).toBe(before)
      spy.mockRestore()
      const retried = await repository.save(root, { id: created.id, name: 'Demo', kind: 'html', content: 'two' })
      expect(retried.createdAt).toBe(created.createdAt)
      expect((await repository.get(root, created.id))?.content).toBe('two')
    })
  })
})
