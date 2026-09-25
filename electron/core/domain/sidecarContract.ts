import { z } from 'zod'
import type { IngestionStreamProgressPayload, TranslateProgressPayload } from '../../../shared/types'

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
    taskId,
  })
  .strict()

export const sidecarUpdateDocumentPayloadSchema = z
  .object({
    docId: nonBlank.max(200),
    markdownContent: z.string().min(1).max(10_000_000),
  })
  .strict()

export const sidecarTranslatePayloadSchema = z
  .object({
    docId: nonBlank.max(200),
    sourceLang: nonBlank.max(100),
    targetLang: nonBlank.max(100),
    model: modelName.optional(),
    targetDir: boundedPath.optional(),
    numCtx: contextTokens.optional(),
    think: z.boolean().optional(),
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
    format: z.enum(['pdf', 'docx', 'html', 'htm']),
    outputFolder: boundedPath.optional(),
  })
  .strict()

const count = z.number().int().nonnegative()
const percent = z.number().min(0).max(100)
const text = z.string().max(20_000)

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
