import { z } from 'zod'
import { documentTextSchema, MAX_DOCUMENT_TEXT_UNITS } from './documentLimits'

const documentDraftSchema = z
  .object({
    docId: z.string().min(1).max(200),
    content: documentTextSchema,
    ingestedAt: z.string().min(1).max(200),
    markdown: documentTextSchema.nullable(),
  })
  .strict()

export const documentDraftsSchema = z
  .array(documentDraftSchema)
  .max(100)
  .superRefine((drafts, context) => {
    if (new Set(drafts.map((draft) => draft.docId)).size !== drafts.length) context.addIssue({ code: 'custom', message: 'Duplicate document drafts' })
    if (drafts.reduce((size, draft) => size + draft.content.length + (draft.markdown?.length ?? 0), 0) > 2 * MAX_DOCUMENT_TEXT_UNITS) {
      context.addIssue({ code: 'custom', message: 'Draft archive exceeds the 20 million character limit; export or save drafts first' })
    }
  })
export const documentDraftSnapshotSchema = z.object({ revision: z.string().min(1).max(64), drafts: documentDraftsSchema }).strict()
export type DocumentDraft = z.infer<typeof documentDraftSchema>
export type DocumentDraftSnapshot = z.infer<typeof documentDraftSnapshotSchema>
