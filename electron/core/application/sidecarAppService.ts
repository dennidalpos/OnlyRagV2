import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import type { DesktopShellPort } from '../domain/ports/desktopShellPort'
import { allWindowsEventSink } from '../infrastructure/electron/rendererEventSinks'
import { electronDesktopShell } from '../infrastructure/electron/electronDesktopShell'
import { logger } from '../infrastructure/logging/logger'
import { sidecarProcessManager } from '../infrastructure/process/sidecarProcessManager'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { sidecarHttpClient, type SidecarDocumentSummary } from '../infrastructure/http/sidecarHttpClient'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import type { IngestedDocument, IngestedDocumentContent, PromptHistorySearchResult, VectorSearchResult } from '../../../shared/types'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

export function normalizeIngestedFileType(fileType?: string, filename?: string): IngestedDocument['fileType'] {
  const rawType = (fileType || filename?.split('.').pop() || '').trim().toLowerCase().replace(/^\./, '')
  if (rawType === 'pdf') return 'pdf'
  if (rawType === 'docx') return 'docx'
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'image'].includes(rawType)) return 'image'
  return 'text'
}

function toIngestedDocument(item: SidecarDocumentSummary): IngestedDocument {
  return {
    id: item.id,
    filename: item.filename,
    filePath: item.file_path || item.filePath || item.filename,
    fileSize: item.file_size,
    numPages: item.num_pages,
    numChunks: item.num_chunks,
    status: item.status as IngestedDocument['status'],
    ingestedAt: item.ingested_at,
    fileType: normalizeIngestedFileType(item.file_type, item.filename),
    usedFallbackEmbeddings: Boolean(item.used_fallback_embeddings),
  }
}

export class SidecarAppService {
  constructor(
    private readonly rendererEvents: RendererEventSink = allWindowsEventSink,
    private readonly desktop: DesktopShellPort = electronDesktopShell,
  ) {}

  async checkHealth() {
    await sidecarProcessManager.checkSidecarHealth()
    return sidecarProcessManager.getSidecarState()
  }

  getStatus() {
    return sidecarHttpClient.getStatus()
  }

  async restartSidecar() {
    logger.log('INFO', 'SidecarApp', 'User requested Sidecar restart...')
    const isOnline = await sidecarProcessManager.restartPythonSidecar()
    return {
      success: isOnline,
      message: isOnline ? 'Sidecar engine restarted successfully.' : 'Failed to restart Sidecar.',
    }
  }

  async ingestFile(
    filePath: string,
    visionModel?: string,
    visionPrompt?: string,
    normalizeWithLlm?: boolean,
    normalizationModel?: string,
    numCtx?: number,
    taskId?: string,
    normalizationThink?: boolean,
  ) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { success: false, error: 'Invalid file path' }
    }
    const effectiveTaskId = taskId || `ingest-${Date.now()}`
    logger.log(
      'INFO',
      'SidecarApp',
      `Ingesting file path (streaming): ${filePath} (normalizeWithLlm=${normalizeWithLlm}, normalizationModel=${normalizationModel})`,
    )
    try {
      const resolvedPath = path.resolve(filePath)
      if (!documentIoRepository.exists(resolvedPath)) {
        return { success: false, error: 'File does not exist on disk' }
      }

      let cancelRequest: (() => void) | undefined

      const result = await sidecarHttpClient.ingestFileStream(
        {
          file_path: resolvedPath,
          task_id: effectiveTaskId,
          vision_model: visionModel || undefined,
          vision_prompt: visionPrompt || undefined,
          normalize_with_llm: normalizeWithLlm || undefined,
          normalization_model: normalizationModel || undefined,
          num_ctx: numCtx || undefined,
          normalization_think: normalizationThink === true,
          embedding_model: await this.configuredEmbeddingModel(),
        },
        (event) => this.rendererEvents.send('ingest:stream-progress', { ...event, taskId: effectiveTaskId }),
        (cancelFn) => {
          cancelRequest = cancelFn
          taskRunner.registerActiveTask(
            effectiveTaskId,
            'ingestion',
            () => {
              if (cancelRequest) cancelRequest()
            },
            { sourcePath: resolvedPath },
          )
        },
      )

      if (result.success && result.data) {
        const filename = path.basename(resolvedPath)
        const finalResult = result.data
        return {
          success: true,
          data: {
            id: finalResult.id,
            filename: finalResult.filename || filename,
            filePath: resolvedPath,
            fileSize: finalResult.file_size,
            numPages: finalResult.num_pages,
            numChunks: finalResult.num_chunks,
            extractedMarkdown: finalResult.extracted_markdown,
            status: finalResult.status,
            ingestedAt: finalResult.ingested_at,
            fileType: normalizeIngestedFileType(finalResult.file_type, finalResult.filename || filename),
            usedFallbackEmbeddings: Boolean(finalResult.used_fallback_embeddings),
          },
        }
      }

      return { success: false, error: result.error || 'Ingestion failed' }
    } catch (err: unknown) {
      logger.log('ERROR', 'SidecarApp', `Unexpected ingestion exception: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    } finally {
      taskRunner.unregisterActiveTask(effectiveTaskId)
    }
  }

  async updateDocument(docId: string, markdownContent: string) {
    if (!docId || typeof docId !== 'string') {
      return { success: false, error: 'Invalid document ID' }
    }
    logger.log('INFO', 'SidecarApp', `Updating document: ${docId}`)
    const result = await sidecarHttpClient.updateDocument(docId, markdownContent, await this.configuredEmbeddingModel())
    if (result.success && result.data) {
      const data = result.data
      return {
        success: true,
        data: {
          id: data.id,
          filename: data.filename,
          fileSize: data.file_size,
          numPages: data.num_pages,
          numChunks: data.num_chunks,
          extractedMarkdown: data.extracted_markdown,
          status: data.status,
          ingestedAt: data.ingested_at,
          fileType: normalizeIngestedFileType(data.file_type, data.filename),
          usedFallbackEmbeddings: Boolean(data.used_fallback_embeddings),
        },
      }
    }
    return { success: false, error: result.error || 'Failed to update document' }
  }

  async translateDocumentInplace(docId: string, sourceLang: string, targetLang: string, model?: string, targetDir?: string, numCtx?: number, think?: boolean) {
    if (!docId || typeof docId !== 'string') {
      return { success: false, error: 'Invalid document ID' }
    }
    const taskId = `translate-${randomUUID()}`
    logger.log('INFO', 'SidecarApp', `Translating document in place (streaming): ${docId} (${sourceLang} -> ${targetLang})`)
    let result: Awaited<ReturnType<typeof sidecarHttpClient.translateDocumentInplaceStream>>
    try {
      result = await sidecarHttpClient.translateDocumentInplaceStream(
        docId,
        {
          source_lang: sourceLang,
          target_lang: targetLang,
          model: model || undefined,
          target_dir: targetDir || undefined,
          num_ctx: numCtx || undefined,
          think: think === true,
          task_id: taskId,
        },
        (event) => this.rendererEvents.send('ingest:translate-progress', { ...event, taskId }),
        (cancel) => taskRunner.registerActiveTask(taskId, 'translation', cancel),
      )
    } finally {
      taskRunner.unregisterActiveTask(taskId)
    }

    if (result.success && result.data) {
      const finalResult = result.data
      return {
        success: true,
        data: {
          id: finalResult.id,
          filename: finalResult.filename,
          filePath: finalResult.filePath,
          fileSize: finalResult.file_size,
          numPages: finalResult.num_pages,
          numChunks: finalResult.num_chunks,
          extractedMarkdown: finalResult.extracted_markdown,
          status: finalResult.status,
          ingestedAt: finalResult.ingested_at,
          fileType: normalizeIngestedFileType(finalResult.file_type, finalResult.filename),
        },
      }
    }

    return { success: false, error: result.error || 'Translation failed' }
  }

  getDocumentPagePreview(docId: string, pageNumber: number) {
    if (!docId || typeof docId !== 'string') return Promise.resolve(null)
    return sidecarHttpClient.getDocumentPagePreview(docId, pageNumber)
  }

  /** Metadata of every indexed document; the Markdown is loaded per document by getIngestedDocument. */
  async listIngestedDocuments(): Promise<IngestedDocument[] | null> {
    const list = await sidecarHttpClient.listDocuments()
    if (!list) return null
    return list.map(toIngestedDocument)
  }

  async getIngestedDocument(docId: string): Promise<IngestedDocumentContent | null> {
    const record = await sidecarHttpClient.getDocument(docId)
    if (!record) return null
    return { ...toIngestedDocument(record), extractedMarkdown: record.extracted_markdown }
  }

  async deleteDocument(docId: string): Promise<{ success: boolean; error?: string }> {
    if (typeof docId !== 'string' || !docId.trim()) return { success: false, error: 'ID documento non valido.' }
    return sidecarHttpClient.deleteDocument(docId)
  }

  searchVectorDb(query: string, topK: number = 5, docIds?: string[]): Promise<VectorSearchResult[]> {
    return sidecarHttpClient.searchVectorDb(query, topK, docIds)
  }

  /** Embedding model for new vectors; search reads each chunk's own model from the store. */
  private async configuredEmbeddingModel(): Promise<string | undefined> {
    const settings = await appSettingsRepository.loadSettings()
    return settings?.embeddingModel?.trim() || undefined
  }

  indexPromptHistory(payload: {
    id: string
    sessionId: string
    workspacePath: string
    prompt: string
    summary?: string
    outcome: string
    startedAt: string
    completedAt?: string
  }): Promise<{ success: boolean }> {
    return sidecarHttpClient.postJson<{ success: boolean }>(
      '/history/index',
      {
        id: payload.id,
        session_id: payload.sessionId,
        project_path: payload.workspacePath,
        prompt: payload.prompt,
        summary: payload.summary,
        outcome: payload.outcome,
        started_at: payload.startedAt,
        completed_at: payload.completedAt,
      },
      5000,
      { success: false },
    )
  }

  searchPromptHistory(query: string, topK: number = 10, projectPaths?: string[]): Promise<PromptHistorySearchResult[]> {
    if (typeof query !== 'string' || !query.trim()) return Promise.resolve([])
    const payload: { query: string; top_k: number; project_paths?: string[] } = { query, top_k: topK }
    if (projectPaths && projectPaths.length > 0) payload.project_paths = projectPaths
    return sidecarHttpClient.postJson<PromptHistorySearchResult[]>('/history/search', payload, 4000, [])
  }

  removePromptHistoryForSessions(sessionIds: string[]): Promise<{ success: boolean }> {
    if (!sessionIds || sessionIds.length === 0) return Promise.resolve({ success: true })
    return sidecarHttpClient.postJson<{ success: boolean }>('/history/remove', { session_ids: sessionIds }, 4000, { success: false })
  }

  removePromptHistoryForProject(projectPath: string): Promise<{ success: boolean }> {
    return sidecarHttpClient.postJson<{ success: boolean }>('/history/remove', { project_path: projectPath }, 4000, { success: false })
  }

  async exportDocument(
    markdownContent: string,
    format: string,
    outputFolder?: string,
  ): Promise<{ success: boolean; message?: string; filePath?: string; error?: string }> {
    if (typeof markdownContent !== 'string' || !markdownContent.trim()) {
      return { success: false, error: 'Il contenuto del documento è vuoto.' }
    }

    const cleanFormat = (format || 'pdf').toLowerCase()
    const defaultExt = cleanFormat === 'pdf' ? 'pdf' : cleanFormat === 'docx' ? 'docx' : 'md'
    const generatedFilename = `OnlyRag_Export_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.${defaultExt}`

    try {
      let targetPath: string
      if (outputFolder && outputFolder.trim() && documentIoRepository.exists(outputFolder)) {
        targetPath = path.join(outputFolder, generatedFilename)
      } else {
        const chosenPath = await this.desktop.showSaveDialog({
          title: `Esporta Documento (${defaultExt.toUpperCase()})`,
          defaultFileName: generatedFilename,
          filters: [
            { name: `${defaultExt.toUpperCase()} Document (*.${defaultExt})`, extensions: [defaultExt] },
            { name: 'Tutti i file (*.*)', extensions: ['*'] },
          ],
        })

        if (!chosenPath) {
          return { success: false, message: "Salvataggio annullato dall'utente." }
        }
        targetPath = chosenPath
      }

      if (defaultExt === 'md') {
        const writeRes = documentIoRepository.writeText(targetPath, markdownContent)
        if (!writeRes.success) {
          return { success: false, error: writeRes.error }
        }
        this.desktop.showItemInFolder(targetPath)
        logger.log('INFO', 'SidecarApp', `Markdown document exported successfully to: ${targetPath}`)
        return {
          success: true,
          message: `Documento Markdown salvato con successo: ${path.basename(targetPath)}`,
          filePath: targetPath,
        }
      }

      const sidecarRes = await sidecarHttpClient.exportDocument(markdownContent, cleanFormat)

      if (sidecarRes.success && sidecarRes.data?.base64_content) {
        const fileBuffer = Buffer.from(sidecarRes.data.base64_content, 'base64')
        const writeRes = documentIoRepository.writeBuffer(targetPath, fileBuffer)
        if (!writeRes.success) {
          return { success: false, error: writeRes.error }
        }
        this.desktop.showItemInFolder(targetPath)
        logger.log('INFO', 'SidecarApp', `PDF/DOCX document exported successfully to: ${targetPath}`)
        return {
          success: true,
          message: `Documento PDF esportato con successo in: ${path.basename(targetPath)}`,
          filePath: targetPath,
        }
      } else {
        return {
          success: false,
          error: sidecarRes.error || 'Impossibile completare la generazione del file PDF dal sidecar.',
        }
      }
    } catch (err: unknown) {
      logger.log('ERROR', 'SidecarApp', `Export exception: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  }
}

export const sidecarAppService = new SidecarAppService()
