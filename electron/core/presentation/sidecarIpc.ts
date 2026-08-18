import { ipcMain } from 'electron'
import { sidecarAppService } from '../application/sidecarAppService'

export function registerSidecarIpcHandlers() {
  ipcMain.handle('sidecar:status', async () => {
    return sidecarAppService.getStatus()
  })

  ipcMain.handle('sidecar:restart', async () => {
    return sidecarAppService.restartSidecar()
  })

  ipcMain.handle('ingest:file', async (_, filePath: string, visionModel?: string, visionPrompt?: string) => {
    return sidecarAppService.ingestFile(filePath, visionModel, visionPrompt)
  })

  ipcMain.handle('ingest:update', async (_, docId: string, markdownContent: string) => {
    return sidecarAppService.updateDocument(docId, markdownContent)
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

  ipcMain.handle('ingest:export', async (_, markdownContent: string, format: string) => {
    return sidecarAppService.exportDocument(markdownContent, format)
  })
}
