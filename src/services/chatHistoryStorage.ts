import type { ChatConversation } from '../types'
import { chatHistorySchema, recoverInterruptedConversations } from '../../shared/domain/chatHistory'

const HISTORY_KEY = 'onlyrag_chat_conversations'
const ACTIVE_KEY = 'onlyrag_chat_active_id'

export type ChatStorageError = 'load' | 'invalid' | 'save'
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadChatHistory(storage?: HistoryStorage): {
  conversations: ChatConversation[]
  activeId: string | null
  error: ChatStorageError | null
} {
  let conversations: ChatConversation[] = []
  try {
    const store = storage ?? window.localStorage
    const raw = store.getItem(HISTORY_KEY)
    if (raw !== null) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { conversations, activeId: null, error: 'invalid' }
      }
      const result = chatHistorySchema.safeParse(parsed)
      if (!result.success || new Set(result.data.map((conversation) => conversation.id)).size !== result.data.length) {
        return { conversations, activeId: null, error: 'invalid' }
      }
      conversations = recoverInterruptedConversations(result.data)
    }
    return { conversations, activeId: store.getItem(ACTIVE_KEY), error: null }
  } catch {
    return { conversations, activeId: null, error: 'load' }
  }
}

export function saveChatHistory(conversations: ChatConversation[], activeId: string, storage?: HistoryStorage): void {
  const store = storage ?? window.localStorage
  // Write messages first: a failed selection write must not cost the conversation.
  store.setItem(HISTORY_KEY, JSON.stringify(conversations))
  store.setItem(ACTIVE_KEY, activeId)
}
