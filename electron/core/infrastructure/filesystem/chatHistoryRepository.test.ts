import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatHistoryRepository } from './chatHistoryRepository'

describe('Main-owned chat recovery', () => {
  let directory: string
  let repo: ChatHistoryRepository
  const state = {
    activeId: 'c',
    conversations: [
      {
        id: 'c',
        title: 'Question',
        createdAt: 't1',
        updatedAt: 't2',
        selectedDocIds: ['doc'],
        messages: [
          { id: 'u', sender: 'user' as const, text: 'Question', timestamp: '12:00' },
          { id: 'b', sender: 'bot' as const, text: 'Partial answer', timestamp: '12:01', isStreaming: true },
        ],
      },
    ],
  }
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onlyrag-chat-recovery-'))
    repo = new ChatHistoryRepository(directory)
  })
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })
  it('acknowledges a partial answer only after readback and recovers it with a fresh repository', async () => {
    const first = await repo.save({ revision: 'missing', state })
    expect((await new ChatHistoryRepository(directory).load()).state).toEqual(state)
    const original = await fs.readFile(path.join(directory, 'chat-history-recovery.json'), 'utf8')
    const next = structuredClone(state)
    next.conversations[0].messages[1].isStreaming = false
    await repo.save({ revision: first.revision, state: next })
    expect(await fs.readFile(path.join(directory, 'chat-history-recovery.json.bak'), 'utf8')).toBe(original)
    await expect(repo.save({ revision: 'missing', state })).rejects.toThrow('changed')
    expect((await repo.load()).state).toEqual(next)
  })
  it('does not overwrite invalid chat data or its retained backup', async () => {
    const file = path.join(directory, 'chat-history-recovery.json')
    await fs.writeFile(file, '{bad')
    await fs.writeFile(file + '.bak', 'retained')
    await expect(repo.load()).rejects.toThrow()
    await expect(repo.save({ revision: 'missing', state })).rejects.toThrow()
    expect(await fs.readFile(file, 'utf8')).toBe('{bad')
    expect(await fs.readFile(file + '.bak', 'utf8')).toBe('retained')
  })
})
