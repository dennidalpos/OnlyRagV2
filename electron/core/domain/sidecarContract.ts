import { z } from 'zod'
import { DOCUMENT_EXPORT_FORMATS } from '../../../shared/domain/documentExport'
import type { IngestionStreamProgressPayload, NormalizationReview, TranslateProgressPayload } from '../../../shared/types'

const nonBlank = z.string().trim().min(1)
const boundedPath = nonBlank.max(4096)
const modelName = nonBlank.max(200)
// The floor stays below every trained context: resolveModelContextLength caps num_ctx at it (moondream: 2048).
const contextTokens = z.number().int().min(256).max(131072)
const taskId = nonBlank.max(200)

export const sidecarIngestFilePayloadSchema = z
  .object({
    filePath: boundedPath,
    visionModel: modelName.optional(),
    visionPrompt: nonBlank.max(20_000).optional(),
    normalizeWithLlm: z.boolean().optional(),
    normalizationModel: modelName.optional(),
    numCtx: contextTokens.optional(),
    normalizationThink: z.boolean().optional(),
    allowFullExcelFormat: z.boolean().optional(),
    taskId,
  })
  .strict()

export const sidecarUpdateDocumentPayloadSchema = z
  .object({
    docId: nonBlank.max(200),
    markdownContent: z.string().min(1).max(10_000_000),
    expectedRevision: nonBlank.max(200),
  })
  .strict()

export const sidecarTranslatePayloadSchema = z
  .object({
    docId: nonBlank.max(200),
    sourceLang: nonBlank.max(100),
    targetLang: nonBlank.max(100),
    taskId,
    model: modelName.optional(),
    targetDir: boundedPath.optional(),
    numCtx: contextTokens.optional(),
    // The switch, or a reasoning level such as "low".
    think: z.union([z.boolean(), nonBlank.max(32)]).optional(),
  })
  .strict()

export const sidecarPagePreviewPayloadSchema = z
  .object({
    docId: nonBlank.max(200),
    pageNumber: z.number().int().min(1),
  })
  .strict()

export const sidecarSearchPayloadSchema = z
  .object({
    query: z.string().min(1).max(100_000),
    topK: z.number().int().min(1).max(100).optional(),
    docIds: z.array(nonBlank.max(200)).max(100).optional(),
  })
  .strict()

export const sidecarExportPayloadSchema = z
  .object({
    markdownContent: z.string().min(1).max(10_000_000),
    format: z.enum(DOCUMENT_EXPORT_FORMATS),
    outputFolder: boundedPath.optional(),
  })
  .strict()

const count = z.number().int().nonnegative()
const percent = z.number().min(0).max(100)
const text = z.string().max(20_000)

/** Wire document fields shared by REST reads and mutation results. */
const documentFields = {
  id: nonBlank.max(200),
  filename: nonBlank.max(4096),
  file_size: count,
  num_pages: count,
  num_chunks: count,
  ingested_at: nonBlank.max(200),
  file_type: nonBlank.max(100),
  used_fallback_embeddings: z.boolean().optional(),
}
export const sidecarDocumentSummarySchema = z.object({
  ...documentFields,
  status: z.enum(['indexed', 'indexed_fallback']),
  file_path: nonBlank.max(4096),
})
export const sidecarDocumentRecordSchema = sidecarDocumentSummarySchema.extend({ extracted_markdown: z.string() })
// Ingest/update responses have no file_path; translation results carry a distinct output filePath.
export const sidecarIngestResultSchema = z.object({
  ...documentFields,
  status: z.enum(['indexed', 'indexed_fallback']),
  extracted_markdown: z.string(),
})
export const sidecarTranslationResultSchema = z.object({
  ...documentFields,
  status: z.literal('translated'),
  filePath: nonBlank.max(4096),
  extracted_markdown: z.string(),
})

const normalizationReviewSchema = z
  .object({
    original_markdown: z.string().min(1).max(10_000_000),
    issues: z
      .array(
        z
          .object({
            page: z.number().int().min(1),
            reason: z.enum([
              'model_missing',
              'context_missing',
              'context_budget_exceeded',
              'request_failed',
              'incomplete_response',
              'truncated',
              'empty_response',
              'entities_changed',
              'content_changed',
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict()

export function parseNormalizationReview(value: unknown): NormalizationReview | null {
  const parsed = normalizationReviewSchema.safeParse(value)
  return parsed.success ? { originalMarkdown: parsed.data.original_markdown, issues: parsed.data.issues } : null
}

/** The Sidecar's ingestion NDJSON event; unknown keys (the `done` document record, `task_id`) are dropped. */
const sidecarIngestProgressEventSchema = z.object({
  type: z.enum(['progress', 'done', 'error', 'cancelled']),
  percent: percent.optional(),
  step: text.optional(),
  error: text.optional(),
  step_code: z.string().max(100).optional(),
  step_params: z.record(z.string().max(100), z.union([z.string().max(4096), z.number()])).optional(),
  pipeline: z.string().max(200).optional(),
  page: count.optional(),
  total_pages: count.optional(),
  fileName: z.string().max(4096).optional(),
  ocrTechnology: z.string().max(200).optional(),
  modelName: z.string().max(200).optional(),
})

/** The Sidecar's in-place translation NDJSON event; unknown keys (the `done` document record, `task_id`) are dropped. */
const sidecarTranslateProgressEventSchema = z.object({
  type: z.enum(['start', 'progress', 'done', 'error', 'cancelled']),
  doc_id: z.string().max(200).optional(),
  filename: z.string().max(4096).optional(),
  page: count.optional(),
  total_pages: count.optional(),
  total_blocks: count.optional(),
  phase: z.enum(['extracting_blocks', 'translating_blocks', 'reconstructing_layout', 'translating_runs']).optional(),
  percent: percent.optional(),
  error: text.optional(),
})

/** The Renderer payload for one ingestion event, or null when the event does not match the declared shape. */
export function toIngestionProgressPayload(event: unknown, taskId: string): IngestionStreamProgressPayload | null {
  const parsed = sidecarIngestProgressEventSchema.safeParse(event)
  return parsed.success ? { ...parsed.data, taskId } : null
}

/** The Renderer payload for one translation event, or null when the event does not match the declared shape. */
export function toTranslateProgressPayload(event: unknown, taskId: string): TranslateProgressPayload | null {
  const parsed = sidecarTranslateProgressEventSchema.safeParse(event)
  return parsed.success ? { ...parsed.data, taskId } : null
}
