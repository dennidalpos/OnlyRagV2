import { z } from 'zod'
import type { ChatConversation } from '../types'
import { sourceProvenanceSchema } from '../../shared/domain/sourceProvenance'

const HISTORY_KEY = 'onlyrag_chat_conversations'
const ACTIVE_KEY = 'onlyrag_chat_active_id'

const citationSchema = z
  .object({
    docName: z.string(),
    chunkId: z.string(),
    score: z.number().finite(),
    snippet: z.string(),
    sectionHeader: z.string().optional(),
    docId: z.string().optional(),
    referenceId: z
      .string()
      .regex(/^S[1-9]\d*$/)
      .optional(),
    citationState: z.enum(['candidate', 'cited']).optional(),
    provenance: sourceProvenanceSchema.nullish(),
  })
  .passthrough()
const historySchema = z.array(
  z
    .object({
      id: z.string().min(1),
      title: z.string(),
      messages: z.array(
        z
          .object({
            id: z.string().min(1),
            sender: z.enum(['user', 'bot']),
            text: z.string(),
            timestamp: z.string(),
            sources: z.array(citationSchema).optional(),
            invalidSourceReferences: z.array(z.string().max(32)).optional(),
            isStreaming: z.boolean().optional(),
          })
          .passthrough(),
      ),
      selectedDocIds: z.array(z.string()),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .passthrough(),
)

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
      const result = historySchema.safeParse(parsed)
      if (!result.success || new Set(result.data.map((conversation) => conversation.id)).size !== result.data.length) {
        return { conversations, activeId: null, error: 'invalid' }
      }
      conversations = result.data
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
