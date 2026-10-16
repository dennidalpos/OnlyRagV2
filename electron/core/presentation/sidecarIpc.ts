import { secureIpcMain as ipcMain } from './secureIpcMain'
import { sidecarAppService } from '../application/sidecarAppService'
import { sessionHistoryAppService } from '../application/sessionHistoryAppService'

export function registerSidecarIpcHandlers() {
  ipcMain.handle('ingest:source-location', (_, payload) => sidecarAppService.getSourceLocation(payload))
  ipcMain.handle('sidecar:restart', async () => {
    return sidecarAppService.restartSidecar()
  })

  ipcMain.handle('ingest:file', async (_, payload) => {
    return sidecarAppService.ingestFile(
      payload.filePath,
      payload.visionModel,
      payload.visionPrompt,
      payload.normalizeWithLlm,
      payload.normalizationModel,
      payload.numCtx,
      payload.taskId,
      payload.normalizationThink,
      payload.allowFullExcelFormat,
    )
  })

  ipcMain.handle('ingest:update', async (_, { docId, markdownContent, expectedRevision }) => {
    return sidecarAppService.updateDocument(docId, markdownContent, expectedRevision)
  })

  ipcMain.handle('ingest:translate-inplace', async (_, { docId, sourceLang, targetLang, taskId, model, targetDir, numCtx, think }) => {
    return sidecarAppService.translateDocumentInplace(docId, sourceLang, targetLang, taskId, model, targetDir, numCtx, think)
  })

  ipcMain.handle('ingest:page-preview', async (_, { docId, pageNumber }) => {
    return sidecarAppService.getDocumentPagePreview(docId, pageNumber)
  })

  ipcMain.handle('ingest:list', async () => {
    return sidecarAppService.listIngestedDocuments()
  })

  ipcMain.handle('ingest:get', async (_, { docId }) => {
    return sidecarAppService.getIngestedDocument(docId)
  })

  ipcMain.handle('ingest:delete', async (_, { docId }) => {
    return sidecarAppService.deleteDocument(docId)
  })

  ipcMain.handle('ingest:search', async (_, { query, topK, docIds }) => {
    return sidecarAppService.searchVectorDb(query, topK, docIds)
  })

  ipcMain.handle('ingest:export', async (_, { markdownContent, format, outputFolder }) => {
    return sidecarAppService.exportDocument(markdownContent, format, outputFolder)
  })

  ipcMain.handle('history:index', async (_, payload) => {
    return sessionHistoryAppService.indexPromptHistory(payload)
  })

  ipcMain.handle('history:search', async (_, { query, topK, projectPaths }) => {
    return sidecarAppService.searchPromptHistory(query, topK, projectPaths)
  })
}
