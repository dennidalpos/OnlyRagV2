import { z } from 'zod'
import { sourceProvenanceSchema } from './sourceProvenance'

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
export const chatHistorySchema = z.array(
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
            interrupted: z.boolean().optional(),
          })
          .passthrough(),
      ),
      selectedDocIds: z.array(z.string()),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .passthrough(),
)

export const chatHistoryStateSchema = z
  .object({ conversations: chatHistorySchema, activeId: z.string().min(1) })
  .strict()
  .superRefine((state, context) => {
    if (
      new Set(state.conversations.map((conversation) => conversation.id)).size !== state.conversations.length ||
      !state.conversations.some((conversation) => conversation.id === state.activeId)
    )
      context.addIssue({ code: 'custom', message: 'Invalid chat conversation identities' })
  })
export const chatHistoryRecoverySchema = z.object({ revision: z.string().min(1).max(64), state: chatHistoryStateSchema.nullable() }).strict()
export const chatHistoryWriteSchema = chatHistoryRecoverySchema.extend({ state: chatHistoryStateSchema })
export type ChatHistoryState = z.infer<typeof chatHistoryStateSchema>
export type ChatHistoryRecovery = z.infer<typeof chatHistoryRecoverySchema>

export function recoverInterruptedConversations(conversations: ChatHistoryState['conversations']) {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => (message.isStreaming ? { ...message, isStreaming: false, interrupted: true } : message)),
  }))
}
