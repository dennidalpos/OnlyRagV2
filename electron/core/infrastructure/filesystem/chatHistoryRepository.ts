import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { chatHistoryStateSchema, type ChatHistoryState, type ChatHistoryRecovery } from '../../../../shared/domain/chatHistory'
import { userDataRoot } from './userDataRoot'
import { safeAtomicWrite } from './safeAtomicFileWriter'

export class ChatHistoryRepository {
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory?: string) {}

  private filePath() {
    return path.join(this.directory ?? userDataRoot(), 'chat-history-recovery.json')
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
        if ((backupError as NodeJS.ErrnoException).code === 'ENOENT') return { raw: null, revision: 'missing', state: null }
        throw backupError
      }
      throw new Error('Chat recovery archive is missing but a backup exists; preserve and recover the backup before writing')
    }
    const value = JSON.parse(raw)
    if (value?.version !== 1) throw new Error('Unsupported chat recovery archive')
    return { raw, revision: createHash('sha256').update(raw).digest('hex'), state: chatHistoryStateSchema.parse(value.state) }
  }

  async load(): Promise<ChatHistoryRecovery> {
    await this.chain
    const { revision, state } = await this.read()
    return { revision, state }
  }

  save(snapshot: ChatHistoryRecovery): Promise<ChatHistoryRecovery> {
    const state: ChatHistoryState = chatHistoryStateSchema.parse(snapshot.state)
    const operation = this.chain.then(async () => {
      const current = await this.read()
      if (JSON.stringify(current.state) === JSON.stringify(state)) return { revision: current.revision, state }
      if (current.revision !== snapshot.revision) throw new Error('Chat recovery archive changed; retry loading before writing')
      if (current.raw !== null) await safeAtomicWrite(this.filePath() + '.bak', current.raw)
      const raw = JSON.stringify({ version: 1, state })
      await safeAtomicWrite(this.filePath(), raw)
      const verified = await this.read()
      if (verified.raw !== raw) throw new Error('Chat recovery archive readback differs from the submitted snapshot')
      return { revision: verified.revision, state: verified.state }
    })
    this.chain = operation.catch(() => undefined)
    return operation
  }
}

export const chatHistoryRepository = new ChatHistoryRepository()
