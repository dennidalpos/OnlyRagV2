import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactRepository } from './artifactRepository'

let workspacePath: string | undefined
const repository = new ArtifactRepository()

afterEach(() => {
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
})
