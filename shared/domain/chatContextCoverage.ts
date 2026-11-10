import { z } from 'zod'

const coverageItemSchema = z
  .object({
    kind: z.enum(['preview', 'passage']),
    docId: z.string().optional(),
    docName: z.string(),
    chunkId: z.string().optional(),
    referenceId: z
      .string()
      .regex(/^S[1-9]\d*$/)
      .optional(),
    status: z.enum(['included', 'truncated', 'excluded']),
    reason: z.enum(['budget', 'empty', 'scope']).optional(),
    originalChars: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    text: z.string().max(14000),
  })
  .strict()
  .superRefine((item, context) => {
    const length = item.text.length
    const valid =
      item.status === 'excluded'
        ? length === 0 && !!item.reason && !item.referenceId
        : !item.reason && length > 0 && (item.status === 'included' ? length === item.originalChars : length < item.originalChars)
    if (!valid || (item.kind === 'preview' && (!item.docId || item.referenceId || item.chunkId)))
      context.addIssue({ code: 'custom', message: 'Invalid document coverage' })
  })

/** Records only this turn's document input, in UTF-16 code units; never semantic support or token coverage. */
export const chatContextCoverageSchema = z
  .object({
    retrieval: z.enum(['completed', 'skipped']),
    items: z.array(coverageItemSchema),
  })
  .strict()

export type ChatContextCoverage = z.infer<typeof chatContextCoverageSchema>
