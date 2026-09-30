import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatConversation, ChatMessage } from '../types'
import { loadChatHistory, saveChatHistory, type ChatStorageError } from '../services/chatHistoryStorage'

export function useChatHistory(createGreeting: () => ChatMessage) {
  const [initial] = useState(() => {
    const loaded = loadChatHistory()
    const conversations: ChatConversation[] = loaded.conversations.length
      ? loaded.conversations
      : [
          {
            id: `session-${Date.now()}`,
            title: '',
            messages: [createGreeting()],
            selectedDocIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]
    const activeId = conversations.some((conversation) => conversation.id === loaded.activeId) ? loaded.activeId! : conversations[0].id
    return { conversations, activeId, error: loaded.error }
  })
  const [conversations, setConversations] = useState(initial.conversations)
  const [activeConversationId, setActiveConversationId] = useState(initial.activeId)
  const [storageError, setStorageError] = useState<ChatStorageError | null>(initial.error)
  const blocked = useRef(initial.error !== null)
  const latest = useRef({ conversations, activeConversationId })
  latest.current = { conversations, activeConversationId }

  const persist = useCallback(() => {
    if (blocked.current) return
    try {
      saveChatHistory(latest.current.conversations, latest.current.activeConversationId)
      setStorageError(null)
    } catch {
      setStorageError('save')
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(persist, 400)
    return () => clearTimeout(timer)
  }, [conversations, activeConversationId, persist])

  useEffect(() => {
    window.addEventListener('beforeunload', persist)
    return () => {
      window.removeEventListener('beforeunload', persist)
      persist()
    }
  }, [persist])

  const retryPersistence = useCallback(() => {
    if (blocked.current) {
      const loaded = loadChatHistory()
      if (loaded.error) {
        setStorageError(loaded.error)
        return
      }
      blocked.current = false
      const merged = [...new Map([...loaded.conversations, ...latest.current.conversations].map((conversation) => [conversation.id, conversation])).values()]
      latest.current = { ...latest.current, conversations: merged }
      setConversations(merged)
    }
    persist()
  }, [persist])

  return { conversations, setConversations, activeConversationId, setActiveConversationId, storageError, retryPersistence }
}
