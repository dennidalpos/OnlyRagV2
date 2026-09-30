import { describe, expect, it } from 'vitest'
import { loadChatHistory, saveChatHistory } from './chatHistoryStorage'
import type { ChatConversation } from '../types'

const conversation: ChatConversation = {
  id: 'one',
  title: 'Notes',
  messages: [{ id: 'message', sender: 'user', text: 'Keep this', timestamp: '12:00' }],
  selectedDocIds: ['doc'],
  createdAt: '2026-09-30',
  updatedAt: '2026-09-30',
}

function store(history: string | null, active = 'one') {
  const values = new Map<string, string>()
  if (history !== null) values.set('onlyrag_chat_conversations', history)
  values.set('onlyrag_chat_active_id', active)
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) }
}

describe('chat history storage', () => {
  it('preserves additional saved fields while validating known data', () => {
    const extended = { ...conversation, extra: 'keep', messages: [{ ...conversation.messages[0], extra: 'keep too' }] }
    const storage = store(JSON.stringify([extended]))
    const loaded = loadChatHistory(storage)
    expect(loaded.conversations).toEqual([extended])
    saveChatHistory(loaded.conversations, 'one', storage)
    expect(JSON.parse(storage.getItem('onlyrag_chat_conversations')!)).toEqual([extended])
  })
  it('reads the existing storage format without changing it', () => {
    const raw = JSON.stringify([conversation])
    const storage = store(raw)
    expect(loadChatHistory(storage)).toEqual({ conversations: [conversation], activeId: 'one', error: null })
    expect(storage.getItem('onlyrag_chat_conversations')).toBe(raw)
  })

  it.each([
    'broken JSON',
    '[{}]',
    JSON.stringify([{ ...conversation, messages: [{ ...conversation.messages[0], sender: 'system' }] }]),
    JSON.stringify([conversation, conversation]),
  ])('rejects malformed history and preserves the original: %s', (raw) => {
    const storage = store(raw)
    expect(loadChatHistory(storage).error).toBe('invalid')
    expect(storage.getItem('onlyrag_chat_conversations')).toBe(raw)
  })

  it('distinguishes an empty store from inaccessible storage', () => {
    expect(loadChatHistory(store(null)).error).toBeNull()
    expect(
      loadChatHistory({
        getItem: () => {
          throw new Error('Access denied')
        },
        setItem: () => {},
      }).error,
    ).toBe('load')
  })

  it('propagates quota failures without deleting saved messages', () => {
    const raw = JSON.stringify([conversation])
    const storage = {
      ...store(raw),
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
    }
    expect(() => saveChatHistory([{ ...conversation, title: 'Pending' }], 'one', storage)).toThrow('Quota exceeded')
    expect(storage.getItem('onlyrag_chat_conversations')).toBe(raw)
  })
})
