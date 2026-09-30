import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatHistory } from './useChatHistory'
import type { ChatConversation } from '../types'

const saved: ChatConversation = {
  id: 'saved',
  title: '',
  messages: [{ id: 'one', sender: 'user', text: 'Original', timestamp: '12:00' }],
  selectedDocIds: [],
  createdAt: 'today',
  updatedAt: 'today',
}

describe('chat persistence recovery', () => {
  let root: Root
  let container: HTMLDivElement
  let history: ReturnType<typeof useChatHistory>
  function Harness() {
    history = useChatHistory(() => ({ id: 'greeting', sender: 'bot', text: 'Welcome', timestamp: '12:00' }))
    return history.storageError ? <div role="alert">{history.storageError}</div> : null
  }
  async function mount() {
    await act(async () => root.render(<Harness />))
  }
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('keeps unreadable history intact through edits and retries', async () => {
    window.localStorage.setItem('onlyrag_chat_conversations', '[{"broken":true}]')
    await mount()
    await act(async () => history.setConversations((current) => current.map((conversation) => ({ ...conversation, title: 'Pending' }))))
    await act(async () => vi.advanceTimersByTime(500))
    await act(async () => history.retryPersistence())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('invalid')
    expect(history.conversations[0].title).toBe('Pending')
    expect(window.localStorage.getItem('onlyrag_chat_conversations')).toBe('[{"broken":true}]')
  })

  it('retains unsaved messages and clears the warning only after a successful retry', async () => {
    window.localStorage.setItem('onlyrag_chat_conversations', JSON.stringify([saved]))
    await mount()
    const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    await act(async () =>
      history.setConversations([{ ...saved, messages: [...saved.messages, { id: 'two', sender: 'bot', text: 'Pending answer', timestamp: '12:01' }] }]),
    )
    await act(async () => vi.advanceTimersByTime(500))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('save')
    expect(history.conversations[0].messages).toHaveLength(2)
    expect(JSON.parse(window.localStorage.getItem('onlyrag_chat_conversations')!)[0].messages).toHaveLength(1)
    write.mockRestore()
    await act(async () => history.retryPersistence())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem('onlyrag_chat_conversations')!)[0].messages).toHaveLength(2)
  })

  it('recovers repaired history while keeping new messages created in memory', async () => {
    window.localStorage.setItem('onlyrag_chat_conversations', 'broken')
    await mount()
    const pendingId = history.conversations[0].id
    await act(async () => history.setConversations((current) => current.map((conversation) => ({ ...conversation, title: 'Pending' }))))
    window.localStorage.setItem('onlyrag_chat_conversations', JSON.stringify([saved]))
    await act(async () => history.retryPersistence())
    expect(history.storageError).toBeNull()
    expect(history.conversations.map((conversation) => conversation.id)).toEqual(['saved', pendingId])
    expect(history.conversations.find((conversation) => conversation.id === pendingId)?.title).toBe('Pending')
  })
})
