import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { documentDraftsSchema, type DocumentDraft, type DocumentDraftSnapshot } from '../../../../shared/domain/documentDraft'
import { userDataRoot } from './userDataRoot'
import { safeAtomicWrite } from './safeAtomicFileWriter'

export class DocumentDraftRepository {
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory?: string) {}

  private filePath() {
    return path.join(this.directory ?? userDataRoot(), 'document-drafts.json')
  }

  private async read() {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try {
        await fs.access(this.filePath() + '.bak')
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code === 'ENOENT') return { raw: null, revision: 'missing', drafts: [] }
        throw backupError
      }
      throw new Error('Draft archive is missing but a backup exists; preserve and recover the backup before writing')
    }
    const value = JSON.parse(raw)
    if (value?.version !== 1) throw new Error('Unsupported document draft archive')
    return { raw, revision: createHash('sha256').update(raw).digest('hex'), drafts: documentDraftsSchema.parse(value.drafts) }
  }

  async load(): Promise<DocumentDraftSnapshot> {
    await this.chain
    const { revision, drafts } = await this.read()
    return { revision, drafts }
  }

  save(snapshot: DocumentDraftSnapshot): Promise<DocumentDraftSnapshot> {
    const drafts: DocumentDraft[] = documentDraftsSchema.parse(snapshot.drafts)
    const operation = this.chain.then(async () => {
      const current = await this.read()
      if (JSON.stringify(current.drafts) === JSON.stringify(drafts)) return { revision: current.revision, drafts }
      if (current.revision !== snapshot.revision) throw new Error('Draft archive changed; retry loading before writing')
      if (current.raw !== null) await safeAtomicWrite(this.filePath() + '.bak', current.raw)
      const raw = JSON.stringify({ version: 1, drafts })
      await safeAtomicWrite(this.filePath(), raw)
      const verified = await this.read()
      if (verified.raw !== raw) throw new Error('Draft archive readback differs from the submitted snapshot')
      return { revision: verified.revision, drafts: verified.drafts }
    })
    this.chain = operation.catch(() => undefined)
    return operation
  }
}

export const documentDraftRepository = new DocumentDraftRepository()
