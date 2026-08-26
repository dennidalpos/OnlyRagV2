import { ipcMain } from 'electron'
import { sidecarAppService } from '../application/sidecarAppService'
import { parsePromptHistoryIndexPayload, parsePromptHistorySearchPayload } from '../domain/promptHistoryContract'

export function registerSidecarIpcHandlers() {
  ipcMain.handle('sidecar:status', async () => {
    return sidecarAppService.getStatus()
  })

  ipcMain.handle('sidecar:restart', async () => {
    return sidecarAppService.restartSidecar()
  })

  ipcMain.handle('ingest:file', async (_, filePath: string, visionModel?: string, visionPrompt?: string, normalizeWithLlm?: boolean, normalizationModel?: string, numCtx?: number) => {
    return sidecarAppService.ingestFile(filePath, visionModel, visionPrompt, normalizeWithLlm, normalizationModel, numCtx)
  })

  ipcMain.handle('ingest:update', async (_, docId: string, markdownContent: string) => {
    return sidecarAppService.updateDocument(docId, markdownContent)
  })

  ipcMain.handle('ingest:translate-inplace', async (_, docId: string, sourceLang: string, targetLang: string, model?: string, backupOriginal?: boolean, targetDir?: string, numCtx?: number) => {
    return sidecarAppService.translateDocumentInplace(docId, sourceLang, targetLang, model, backupOriginal, targetDir, numCtx)
  })

  ipcMain.handle('ingest:page-preview', async (_, docId: string, pageNumber: number) => {
    return sidecarAppService.getDocumentPagePreview(docId, pageNumber)
  })

  ipcMain.handle('ingest:list', async () => {
    return sidecarAppService.listIngestedDocuments()
  })

  ipcMain.handle('ingest:delete', async (_, docId: string) => {
    return sidecarAppService.deleteDocument(docId)
  })

  ipcMain.handle('ingest:search', async (_, query: string, topK?: number, embeddingModel?: string, docIds?: string[]) => {
    return sidecarAppService.searchVectorDb(query, topK, embeddingModel, docIds)
  })

  ipcMain.handle('ingest:export', async (_, markdownContent: string, format: string, outputFolder?: string) => {
    return sidecarAppService.exportDocument(markdownContent, format, outputFolder)
  })

  ipcMain.handle('history:index', async (_, payload: unknown) => {
    return sidecarAppService.indexPromptHistory(parsePromptHistoryIndexPayload(payload))
  })

  ipcMain.handle('history:search', async (_, query: string, topK?: number, projectPaths?: string[]) => {
    const payload = parsePromptHistorySearchPayload(query, topK, projectPaths)
    return sidecarAppService.searchPromptHistory(payload.query, payload.topK, payload.projectPaths)
  })
}
