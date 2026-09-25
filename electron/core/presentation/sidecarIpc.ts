import { secureIpcMain as ipcMain } from './secureIpcMain'
import { sidecarAppService } from '../application/sidecarAppService'

export function registerSidecarIpcHandlers() {
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
    )
  })

  ipcMain.handle('ingest:update', async (_, { docId, markdownContent }) => {
    return sidecarAppService.updateDocument(docId, markdownContent)
  })

  ipcMain.handle('ingest:translate-inplace', async (_, { docId, sourceLang, targetLang, model, targetDir, numCtx, think }) => {
    return sidecarAppService.translateDocumentInplace(docId, sourceLang, targetLang, model, targetDir, numCtx, think)
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
    return sidecarAppService.indexPromptHistory(payload)
  })

  ipcMain.handle('history:search', async (_, { query, topK, projectPaths }) => {
    return sidecarAppService.searchPromptHistory(query, topK, projectPaths)
  })
}
