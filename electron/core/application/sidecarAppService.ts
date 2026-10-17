import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import type { DocumentExportFormat } from '../../../shared/domain/documentExport'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import type { IpcEventContract } from '../../../shared/ipc/ipcContract'
import type {
  IngestedDocument,
  IngestedDocumentContent,
  OllamaThinkValue,
  PromptHistorySearchResult,
  SourceLocationRequest,
  VectorSearchResult,
} from '../../../shared/types'
import type { DesktopShellPort } from '../domain/ports/desktopShellPort'
import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import { toIngestionProgressPayload, toTranslateProgressPayload } from '../domain/sidecarContract'
import { electronDesktopShell } from '../infrastructure/electron/electronDesktopShell'
import { allWindowsEventSink } from '../infrastructure/electron/rendererEventSinks'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { type SidecarDocumentRecord, type SidecarDocumentSummary, sidecarHttpClient } from '../infrastructure/http/sidecarHttpClient'
import { logger } from '../infrastructure/logging/logger'
import { sidecarProcessManager } from '../infrastructure/process/sidecarProcessManager'
import { taskRunner } from '../infrastructure/process/taskRunner'

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

function toIngestedDocumentContent(record: SidecarDocumentRecord): IngestedDocumentContent {
  return { ...toIngestedDocument(record), extractedMarkdown: record.extracted_markdown }
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

  getSourceLocation(payload: SourceLocationRequest) {
    return sidecarHttpClient.getSourceLocation(payload)
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
    allowFullExcelFormat?: boolean,
  ) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { success: false, error: 'Invalid file path' }
    }
    const effectiveTaskId = taskId || `ingest-${Date.now()}`
    let registered = false
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
          allow_full_excel_format: allowFullExcelFormat === true,
          embedding_model: await this.configuredEmbeddingModel(),
        },
        (event) => this.relayProgress('ingest:stream-progress', toIngestionProgressPayload(event, effectiveTaskId), event.type),
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
          registered = true
        },
      )

      if (result.success && result.data) {
        const filename = result.data.filename || path.basename(resolvedPath)
        return { success: true, data: { ...toIngestedDocumentContent({ ...result.data, filename }), filePath: resolvedPath } }
      }

      return {
        success: false,
        error: result.error || 'Ingestion failed',
        ...(result.cancelled ? { cancelled: true } : {}),
        ...(result.normalizationReview ? { normalizationReview: result.normalizationReview } : {}),
      }
    } catch (err: unknown) {
      logger.log('ERROR', 'SidecarApp', `Unexpected ingestion exception: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    } finally {
      if (registered) taskRunner.unregisterActiveTask(effectiveTaskId)
    }
  }

  async updateDocument(docId: string, markdownContent: string, expectedRevision: string) {
    if (!docId || typeof docId !== 'string') {
      return { success: false, error: 'Invalid document ID' }
    }
    logger.log('INFO', 'SidecarApp', `Updating document: ${docId}`)
    const result = await sidecarHttpClient.updateDocument(docId, markdownContent, expectedRevision, await this.configuredEmbeddingModel())
    if (result.success && result.data) {
      return { success: true, data: toIngestedDocumentContent(result.data) }
    }
    return { success: false, error: result.error || 'Failed to update document' }
  }

  async translateDocumentInplace(
    docId: string,
    sourceLang: string,
    targetLang: string,
    taskId: string,
    model?: string,
    targetDir?: string,
    numCtx?: number,
    think?: OllamaThinkValue,
  ) {
    if (!docId || typeof docId !== 'string') {
      return { success: false, error: 'Invalid document ID' }
    }
    logger.log('INFO', 'SidecarApp', `Translating document in place (streaming): ${docId} (${sourceLang} -> ${targetLang})`)
    let result: Awaited<ReturnType<typeof sidecarHttpClient.translateDocumentInplaceStream>>
    let registered = false
    try {
      result = await sidecarHttpClient.translateDocumentInplaceStream(
        docId,
        {
          source_lang: sourceLang,
          target_lang: targetLang,
          model: model || undefined,
          target_dir: targetDir || undefined,
          num_ctx: numCtx || undefined,
          think: typeof think === 'string' ? think : think === true,
          task_id: taskId,
        },
        (event) => this.relayProgress('ingest:translate-progress', toTranslateProgressPayload(event, taskId), event.type),
        (cancel) => {
          taskRunner.registerActiveTask(taskId, 'translation', cancel)
          registered = true
        },
      )
    } finally {
      if (registered) taskRunner.unregisterActiveTask(taskId)
    }

    if (result.success && result.data) {
      return { success: true, data: { ...toIngestedDocumentContent(result.data), status: 'translated' as const } }
    }

    return { success: false, error: result.error || 'Translation failed', ...(result.cancelled ? { cancelled: true } : {}) }
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
    return record ? toIngestedDocumentContent(record) : null
  }

  async deleteDocument(docId: string): Promise<{ success: boolean; error?: string }> {
    if (typeof docId !== 'string' || !docId.trim()) return { success: false, error: 'ID documento non valido.' }
    return sidecarHttpClient.deleteDocument(docId)
  }

  searchVectorDb(query: string, topK: number = 5, docIds?: string[]): Promise<VectorSearchResult[]> {
    return sidecarHttpClient.searchVectorDb(query, topK, docIds)
  }

  /** Forwards a validated progress event; an event outside the declared shape is logged and not shown. */
  private relayProgress<C extends 'ingest:stream-progress' | 'ingest:translate-progress'>(
    channel: C,
    payload: IpcEventContract[C] | null,
    eventType: unknown,
  ): void {
    if (payload) this.rendererEvents.send(channel, payload)
    else logger.log('WARN', 'SidecarApp', `Dropped a malformed Sidecar progress event on ${channel} (type: ${String(eventType)}).`)
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

  async searchPromptHistory(query: string, topK: number = 10, projectPaths?: string[]): Promise<PromptHistorySearchResult[]> {
    if (typeof query !== 'string' || !query.trim()) return []
    const payload: { query: string; top_k: number; project_paths?: string[] } = { query, top_k: topK }
    if (projectPaths && projectPaths.length > 0) payload.project_paths = projectPaths
    const result = await sidecarHttpClient.postJsonEnvelope<unknown>('/history/search', payload, 4000)
    if (!result.success) throw new Error(`Prompt history search failed: ${result.error}`)
    return z
      .array(
        z.object({
          id: z.string(),
          session_id: z.string(),
          project_id: z.string(),
          project_path: z.string(),
          prompt: z.string(),
          summary: z.string().nullish(),
          outcome: z.enum(['running', 'success', 'failed', 'cancelled', 'unknown']),
          started_at: z.string(),
          completed_at: z.string().nullish(),
          score: z.number().finite(),
        }),
      )
      .parse(result.data)
      .map((row) => ({ ...row, summary: row.summary ?? undefined, completed_at: row.completed_at ?? undefined }))
  }

  async removePromptHistoryForSessions(sessionIds: string[], operationId?: string): Promise<{ success: boolean }> {
    if (!sessionIds || sessionIds.length === 0) return { success: true }
    return this.removePromptHistory({ session_ids: sessionIds, ...(operationId ? { operation_id: operationId } : {}) })
  }

  async restorePromptHistoryForSessions(sessionIds: string[], operationId: string): Promise<{ success: boolean }> {
    if (sessionIds.length === 0) return { success: true }
    return this.removePromptHistory({ session_ids: sessionIds, operation_id: operationId, restore: true })
  }

  removePromptHistoryForProject(projectPath: string): Promise<{ success: boolean }> {
    return this.removePromptHistory({ project_path: projectPath })
  }

  private async removePromptHistory(payload: {
    session_ids?: string[]
    project_path?: string
    operation_id?: string
    restore?: boolean
  }): Promise<{ success: boolean }> {
    const result = await sidecarHttpClient.postJsonEnvelope<unknown>('/history/remove', payload, 4000)
    if (!result.success) return { success: false }
    const response = z.object({ success: z.boolean() }).safeParse(result.data)
    return response.success ? response.data : { success: false }
  }

  async exportDocument(
    markdownContent: string,
    format: DocumentExportFormat,
    outputFolder?: string,
  ): Promise<{ success: boolean; message?: string; filePath?: string; error?: string }> {
    if (typeof markdownContent !== 'string' || !markdownContent.trim()) {
      return { success: false, error: 'Il contenuto del documento è vuoto.' }
    }

    const cleanFormat = format === 'htm' ? 'html' : format
    const defaultExt = cleanFormat
    const newFilename = () => `OnlyRag_Export_${new Date().toISOString().slice(0, 10)}_${crypto.randomUUID()}.${defaultExt}`
    const generatedFilename = newFilename()

    try {
      let targetPath: string
      const automaticFolder = outputFolder?.trim() && documentIoRepository.exists(outputFolder) ? outputFolder : undefined
      if (automaticFolder) {
        targetPath = path.join(automaticFolder, generatedFilename)
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

      let content: string | Buffer = markdownContent
      if (defaultExt !== 'md') {
        const sidecarRes = await sidecarHttpClient.exportDocument(markdownContent, cleanFormat)
        if (!sidecarRes.success || !sidecarRes.data?.base64_content) {
          return { success: false, error: sidecarRes.error || 'Impossibile completare la generazione del documento dal sidecar.' }
        }
        content = Buffer.from(sidecarRes.data.base64_content, 'base64')
      }

      if (automaticFolder) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const writeRes = documentIoRepository.createExportFile(targetPath, content)
          if (writeRes.success) break
          if (!writeRes.collision) return { success: false, error: writeRes.error }
          if (attempt === 2) return { success: false, error: 'Impossibile creare un nome di export libero dopo 3 tentativi.' }
          targetPath = path.join(automaticFolder, newFilename())
        }
      } else {
        const writeRes =
          typeof content === 'string' ? documentIoRepository.writeText(targetPath, content) : documentIoRepository.writeBuffer(targetPath, content)
        if (!writeRes.success) return { success: false, error: writeRes.error }
      }
      this.desktop.showItemInFolder(targetPath)
      logger.log('INFO', 'SidecarApp', `${defaultExt.toUpperCase()} document exported successfully to: ${targetPath}`)
      return {
        success: true,
        message: `Documento ${defaultExt.toUpperCase()} esportato con successo in: ${path.basename(targetPath)}`,
        filePath: targetPath,
      }
    } catch (err: unknown) {
      logger.log('ERROR', 'SidecarApp', `Export exception: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  }
}

export const sidecarAppService = new SidecarAppService()
