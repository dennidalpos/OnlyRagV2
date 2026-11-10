import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocumentDraftRepository } from './documentDraftRepository'

describe('document draft archive', () => {
  let directory: string
  let repo: DocumentDraftRepository
  const draft = { docId: 'a', content: 'Local edit', ingestedAt: 't1', markdown: 'Original' }
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onlyrag-drafts-'))
    repo = new DocumentDraftRepository(directory)
  })
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('reads back multiple drafts after restart with their original revisions and keeps the previous archive', async () => {
    const first = await repo.save({ revision: 'missing', drafts: [draft] })
    const original = await fs.readFile(path.join(directory, 'document-drafts.json'), 'utf8')
    const next = await repo.save({ revision: first.revision, drafts: [draft, { ...draft, docId: 'b', ingestedAt: 'older-revision' }] })
    expect(await new DocumentDraftRepository(directory).load()).toEqual(next)
    expect(await fs.readFile(path.join(directory, 'document-drafts.json.bak'), 'utf8')).toBe(original)
    expect((await repo.save(next)).revision).toBe(next.revision)
  })

  it('refuses unreadable and unsupported archives without replacing them or their backup', async () => {
    for (const raw of ['{bad', '{"version":99,"drafts":[]}', '{"version":1,"drafts":[{}]}']) {
      await fs.writeFile(path.join(directory, 'document-drafts.json'), raw)
      await fs.writeFile(path.join(directory, 'document-drafts.json.bak'), 'retained-backup')
      await expect(repo.load()).rejects.toThrow()
      await expect(repo.save({ revision: 'missing', drafts: [draft] })).rejects.toThrow()
      expect(await fs.readFile(path.join(directory, 'document-drafts.json'), 'utf8')).toBe(raw)
      expect(await fs.readFile(path.join(directory, 'document-drafts.json.bak'), 'utf8')).toBe('retained-backup')
    }
  })

  it('fences concurrent stale snapshots and permits retry of the identical acknowledged snapshot', async () => {
    const first = repo.save({ revision: 'missing', drafts: [draft] })
    const stale = repo.save({ revision: 'missing', drafts: [{ ...draft, content: 'Stale overwrite' }] })
    await first
    await expect(stale).rejects.toThrow('changed')
    expect((await repo.load()).drafts).toEqual([draft])
    await expect(repo.save({ revision: 'missing', drafts: [draft] })).resolves.toMatchObject({ drafts: [draft] })
  })

  it('preserves a backup when the primary is absent and refuses duplicated document identities', async () => {
    await fs.writeFile(path.join(directory, 'document-drafts.json.bak'), 'recover-me')
    await expect(repo.load()).rejects.toThrow('backup exists')
    await expect(repo.save({ revision: 'missing', drafts: [draft] })).rejects.toThrow('backup exists')
    expect(() => repo.save({ revision: 'missing', drafts: [draft, draft] })).toThrow('Duplicate')
    expect(await fs.readFile(path.join(directory, 'document-drafts.json.bak'), 'utf8')).toBe('recover-me')
  })
})
