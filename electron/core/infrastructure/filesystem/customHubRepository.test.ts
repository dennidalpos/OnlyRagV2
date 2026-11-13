import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BUILTIN_HUB_SOURCES, CustomHubRepository, CustomHubStoreError } from './customHubRepository'
import { userDataRoot } from './userDataRoot'

const hubFile = () => path.join(userDataRoot(), 'custom_hubs.json')
const input = (name: string) => ({ name, url: `https://example.invalid/${name}`, type: 'json-catalog' as const })

describe('CustomHubRepository integrity', () => {
  let repo: CustomHubRepository

  beforeEach(() => {
    repo = new CustomHubRepository()
    if (fs.existsSync(hubFile())) fs.renameSync(hubFile(), `${hubFile()}.retained-${crypto.randomUUID()}`)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats an absent file as an empty valid store', async () => {
    expect(await repo.listSources()).toEqual(BUILTIN_HUB_SOURCES)
    const added = await repo.addSource(input('first'))
    expect((await new CustomHubRepository().listSources()).map((s) => s.id)).toContain(added.id)
  })

  it('rejects listing and mutation on a truncated file and preserves its bytes', async () => {
    const truncated = '[{"id":"custom-a","name":"A","url":"https://a.invalid"},{"id":"cus'
    fs.mkdirSync(path.dirname(hubFile()), { recursive: true })
    fs.writeFileSync(hubFile(), truncated, 'utf-8')

    await expect(repo.listSources()).rejects.toBeInstanceOf(CustomHubStoreError)
    await expect(repo.addSource(input('second'))).rejects.toBeInstanceOf(CustomHubStoreError)
    await expect(repo.removeSource('custom-a')).rejects.toBeInstanceOf(CustomHubStoreError)
    expect(fs.readFileSync(hubFile(), 'utf-8')).toBe(truncated)
  })

  it('rejects structurally invalid content without rewriting it', async () => {
    fs.mkdirSync(path.dirname(hubFile()), { recursive: true })
    fs.writeFileSync(hubFile(), '{"not":"an array"}', 'utf-8')
    await expect(repo.listSources()).rejects.toBeInstanceOf(CustomHubStoreError)
    fs.writeFileSync(hubFile(), '[{"id":1}]', 'utf-8')
    await expect(repo.addSource(input('third'))).rejects.toBeInstanceOf(CustomHubStoreError)
    expect(fs.readFileSync(hubFile(), 'utf-8')).toBe('[{"id":1}]')
  })

  it('keeps the previous list when the rename fails and recovers on retry', async () => {
    const first = await repo.addSource(input('keep'))
    const before = fs.readFileSync(hubFile(), 'utf-8')

    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
    await expect(repo.addSource(input('lost'))).rejects.toThrow('disk full')
    expect(fs.readFileSync(hubFile(), 'utf-8')).toBe(before)
    expect(fs.readdirSync(path.dirname(hubFile())).filter((n) => n.includes('.tmp-'))).toEqual([])

    rename.mockRestore()
    const retried = await repo.addSource(input('lost'))
    const ids = (await new CustomHubRepository().listSources()).filter((s) => !s.isBuiltin).map((s) => s.id)
    expect(ids).toEqual([first.id, retried.id])
  })

  it('does not lose concurrent additions', async () => {
    const added = await Promise.all(['a', 'b', 'c', 'd'].map((n) => repo.addSource(input(n))))
    const ids = (await repo.listSources()).filter((s) => !s.isBuiltin).map((s) => s.id)
    expect(ids.sort()).toEqual(added.map((s) => s.id).sort())
  })

  it('removes a custom hub and refuses built-ins', async () => {
    const added = await repo.addSource(input('removable'))
    await expect(repo.removeSource(BUILTIN_HUB_SOURCES[0].id)).rejects.toThrow('built-in')
    expect(await repo.removeSource(added.id)).toBe(true)
    expect(await repo.listSources()).toEqual(BUILTIN_HUB_SOURCES)
  })
})
