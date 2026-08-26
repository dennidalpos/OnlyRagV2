import { z } from 'zod'

const nonBlank = z.string().trim().min(1)
const boundedPath = nonBlank.max(4096)
const modelName = nonBlank.max(200)
const contextTokens = z.number().int().min(4096).max(131072)

export const sidecarIngestFilePayloadSchema = z.object({
  filePath: boundedPath,
  visionModel: modelName.optional(),
  visionPrompt: nonBlank.max(20_000).optional(),
  normalizeWithLlm: z.boolean().optional(),
  normalizationModel: modelName.optional(),
  numCtx: contextTokens.optional(),
}).strict()

export const sidecarUpdateDocumentPayloadSchema = z.object({
  docId: nonBlank.max(200),
  markdownContent: z.string().min(1).max(10_000_000),
}).strict()

export const sidecarTranslatePayloadSchema = z.object({
  docId: nonBlank.max(200),
  sourceLang: nonBlank.max(100),
  targetLang: nonBlank.max(100),
  model: modelName.optional(),
  backupOriginal: z.boolean().optional(),
  targetDir: boundedPath.optional(),
  numCtx: contextTokens.optional(),
}).strict()

export const sidecarPagePreviewPayloadSchema = z.object({
  docId: nonBlank.max(200),
  pageNumber: z.number().int().min(1),
}).strict()

export const sidecarSearchPayloadSchema = z.object({
  query: z.string().min(1).max(100_000),
  topK: z.number().int().min(1).max(100).optional(),
  embeddingModel: modelName.optional(),
  docIds: z.array(nonBlank.max(200)).max(100).optional(),
}).strict()

export const sidecarExportPayloadSchema = z.object({
  markdownContent: z.string().min(1).max(10_000_000),
  format: z.enum(['pdf', 'docx', 'html', 'htm']),
  outputFolder: boundedPath.optional(),
}).strict()

export type SidecarIngestFilePayload = z.infer<typeof sidecarIngestFilePayloadSchema>
export type SidecarUpdateDocumentPayload = z.infer<typeof sidecarUpdateDocumentPayloadSchema>
export type SidecarTranslatePayload = z.infer<typeof sidecarTranslatePayloadSchema>
export type SidecarPagePreviewPayload = z.infer<typeof sidecarPagePreviewPayloadSchema>
export type SidecarSearchPayload = z.infer<typeof sidecarSearchPayloadSchema>
export type SidecarExportPayload = z.infer<typeof sidecarExportPayloadSchema>
