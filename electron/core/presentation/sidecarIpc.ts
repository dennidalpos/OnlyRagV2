import { ipcMain } from 'electron'
import { sidecarAppService } from '../application/sidecarAppService'
import { parsePromptHistoryIndexPayload, parsePromptHistorySearchPayload } from '../domain/promptHistoryContract'
import {
  sidecarExportPayloadSchema,
  sidecarIngestFilePayloadSchema,
  sidecarPagePreviewPayloadSchema,
  sidecarSearchPayloadSchema,
  sidecarTranslatePayloadSchema,
  sidecarUpdateDocumentPayloadSchema,
  type SidecarExportPayload,
  type SidecarIngestFilePayload,
  type SidecarPagePreviewPayload,
  type SidecarSearchPayload,
  type SidecarTranslatePayload,
  type SidecarUpdateDocumentPayload,
} from '../domain/sidecarContract'

export function registerSidecarIpcHandlers() {
  ipcMain.handle('sidecar:status', async () => {
    return sidecarAppService.getStatus()
  })

  ipcMain.handle('sidecar:restart', async () => {
    return sidecarAppService.restartSidecar()
  })

  ipcMain.handle('ingest:file', async (_, filePath: string, visionModel?: string, visionPrompt?: string, normalizeWithLlm?: boolean, normalizationModel?: string, numCtx?: number) => {
    const payload: SidecarIngestFilePayload = sidecarIngestFilePayloadSchema.parse({ filePath, visionModel, visionPrompt, normalizeWithLlm, normalizationModel, numCtx })
    return sidecarAppService.ingestFile(payload.filePath, payload.visionModel, payload.visionPrompt, payload.normalizeWithLlm, payload.normalizationModel, payload.numCtx)
  })

  ipcMain.handle('ingest:update', async (_, docId: string, markdownContent: string) => {
    const payload: SidecarUpdateDocumentPayload = sidecarUpdateDocumentPayloadSchema.parse({ docId, markdownContent })
    return sidecarAppService.updateDocument(payload.docId, payload.markdownContent)
  })

  ipcMain.handle('ingest:translate-inplace', async (_, docId: string, sourceLang: string, targetLang: string, model?: string, backupOriginal?: boolean, targetDir?: string, numCtx?: number) => {
    const payload: SidecarTranslatePayload = sidecarTranslatePayloadSchema.parse({ docId, sourceLang, targetLang, model, backupOriginal, targetDir, numCtx })
    return sidecarAppService.translateDocumentInplace(payload.docId, payload.sourceLang, payload.targetLang, payload.model, payload.backupOriginal, payload.targetDir, payload.numCtx)
  })

  ipcMain.handle('ingest:page-preview', async (_, docId: string, pageNumber: number) => {
    const payload: SidecarPagePreviewPayload = sidecarPagePreviewPayloadSchema.parse({ docId, pageNumber })
    return sidecarAppService.getDocumentPagePreview(payload.docId, payload.pageNumber)
  })

  ipcMain.handle('ingest:list', async () => {
    return sidecarAppService.listIngestedDocuments()
  })

  ipcMain.handle('ingest:delete', async (_, docId: string) => {
    return sidecarAppService.deleteDocument(docId)
  })

  ipcMain.handle('ingest:search', async (_, query: string, topK?: number, embeddingModel?: string, docIds?: string[]) => {
    const payload: SidecarSearchPayload = sidecarSearchPayloadSchema.parse({ query, topK, embeddingModel, docIds })
    return sidecarAppService.searchVectorDb(payload.query, payload.topK, payload.embeddingModel, payload.docIds)
  })

  ipcMain.handle('ingest:export', async (_, markdownContent: string, format: string, outputFolder?: string) => {
    const payload: SidecarExportPayload = sidecarExportPayloadSchema.parse({ markdownContent, format, outputFolder })
    return sidecarAppService.exportDocument(payload.markdownContent, payload.format, payload.outputFolder)
  })

  ipcMain.handle('history:index', async (_, payload: unknown) => {
    return sidecarAppService.indexPromptHistory(parsePromptHistoryIndexPayload(payload))
  })

  ipcMain.handle('history:search', async (_, query: string, topK?: number, projectPaths?: string[]) => {
    const payload = parsePromptHistorySearchPayload(query, topK, projectPaths)
    return sidecarAppService.searchPromptHistory(payload.query, payload.topK, payload.projectPaths)
  })
}
