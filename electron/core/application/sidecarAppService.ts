/**
 * electron/core/application/sidecarAppService.ts
 *
 * Application Layer — Orchestrator for Python FastAPI Sidecar use cases.
 * Coordinates document ingestion, semantic search, prompt history indexing,
 * document translation, export compilation, and SLM log anomaly diagnostics.
 *
 * All network transport is delegated to SidecarHttpClient (Infrastructure layer).
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BrowserWindow } from 'electron'
import { logger } from '../../diagnostics'
import { sidecarProcessManager } from '../infrastructure/process/sidecarProcessManager'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { sidecarHttpClient } from '../infrastructure/http/sidecarHttpClient'
import type { SlmLogDiagnosticReport } from '../../../shared/types'

export function getAnomalyRemediation(anomalyType: string): string {
  if (anomalyType.includes('CUDA_OOM') || anomalyType.includes('VRAM_EXCEEDED')) {
    return 'Memoria VRAM GPU esaurita. Riduci il context window (num_ctx: 8192 o 4096) o seleziona un modello con quantizzazione più compatta (es. q4_k_m).'
  }
  if (anomalyType.includes('TRUNCATED_JSON')) {
    return 'Risposta JSON del modello troncata o non valida. Aumenta num_ctx o passa a un modello coding dedicato (es. qwen2.5-coder:7b).'
  }
  if (anomalyType.includes('TOOL_LOOP')) {
    return 'Loop di chiamate identiche rilevato. Riformula il prompt o interrompi l\'agente per evitare consumo inutile di token.'
  }
  if (anomalyType.includes('GATEWAY_TIMEOUT') || anomalyType.includes('OLLAMA_TIMEOUT')) {
    return 'Connessione a Ollama o Sidecar scaduta o rifiutata. Verifica che il demone Ollama sia attivo sulla porta 11434.'
  }
  if (anomalyType.includes('CIRCUIT_BREAKER')) {
    return 'Intervento del Circuit Breaker di sicurezza: l\'esecuzione è stata arrestata per prevenire loop infiniti.'
  }
  if (anomalyType.includes('FS_PERMISSIONS')) {
    return 'Errore nei permessi del filesystem (EPERM/EACCES). Assicurati che OnlyRag abbia i permessi di scrittura nel workspace.'
  }
  return 'Controlla i log completi e verifica la corretta configurazione dell\'ambiente di esecuzione.'
}

export class SidecarAppService {
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
    numCtx?: number
  ) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { success: false, error: 'Invalid file path' }
    }
    logger.log(
      'INFO',
      'SidecarApp',
      `Ingesting file path (streaming): ${filePath} (normalizeWithLlm=${normalizeWithLlm}, normalizationModel=${normalizationModel})`
    )
    try {
      const resolvedPath = path.resolve(filePath)
      if (!documentIoRepository.exists(resolvedPath)) {
        return { success: false, error: 'File does not exist on disk' }
      }

      const taskId = `ingest-${Date.now()}`
      let cancelRequest: (() => void) | undefined

      const result = await sidecarHttpClient.ingestFileStream(
        {
          file_path: resolvedPath,
          vision_model: visionModel || undefined,
          vision_prompt: visionPrompt || undefined,
          normalize_with_llm: normalizeWithLlm || undefined,
          normalization_model: normalizationModel || undefined,
          num_ctx: numCtx || undefined,
        },
        (event) => {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) {
              win.webContents.send('ingest:stream-progress', event)
            }
          })
        },
        (cancelFn) => {
          cancelRequest = cancelFn
          taskRunner.registerActiveTask(
            taskId,
            'ingestion',
            () => {
              if (cancelRequest) cancelRequest()
            },
            resolvedPath
          )
        }
      )

      taskRunner.unregisterActiveTask(taskId)

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
            fileType: filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text',
            usedFallbackEmbeddings: Boolean(finalResult.used_fallback_embeddings),
          },
        }
      }

      return { success: false, error: result.error || 'Ingestion failed' }
    } catch (err: any) {
      logger.log('ERROR', 'SidecarApp', `Unexpected ingestion exception: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async updateDocument(docId: string, markdownContent: string) {
    if (!docId || typeof docId !== 'string') {
      return { success: false, error: 'Invalid document ID' }
    }
    logger.log('INFO', 'SidecarApp', `Updating document: ${docId}`)
    const result = await sidecarHttpClient.updateDocument(docId, markdownContent)
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
          fileType: (data.filename || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'text',
          usedFallbackEmbeddings: Boolean(data.used_fallback_embeddings),
        },
      }
    }
    return { success: false, error: result.error || 'Failed to update document' }
  }

  async translateDocumentInplace(
    docId: string,
    sourceLang: string,
    targetLang: string,
    model?: string,
    backupOriginal: boolean = true,
    targetDir?: string,
    numCtx?: number
  ) {
    if (!docId || typeof docId !== 'string') {
      return { success: false, error: 'Invalid document ID' }
    }
    logger.log('INFO', 'SidecarApp', `Translating document in place (streaming): ${docId} (${sourceLang} -> ${targetLang})`)
    const result = await sidecarHttpClient.translateDocumentInplaceStream(
      docId,
      {
        source_lang: sourceLang,
        target_lang: targetLang,
        model: model || undefined,
        backup_original: backupOriginal,
        target_dir: targetDir || undefined,
        num_ctx: numCtx || undefined,
      },
      (event) => {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('ingest:translate-progress', event)
          }
        })
      }
    )

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
          fileType: (finalResult.filename || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
        },
      }
    }

    return { success: false, error: result.error || 'Translation failed' }
  }

  getDocumentPagePreview(docId: string, pageNumber: number) {
    if (!docId || typeof docId !== 'string') return Promise.resolve(null)
    return sidecarHttpClient.getDocumentPagePreview(docId, pageNumber)
  }

  async listIngestedDocuments(): Promise<any[] | null> {
    const list = await sidecarHttpClient.listDocuments()
    if (!list) return null
    return list.map((item) => ({
      id: item.id,
      filename: item.filename,
      filePath: item.file_path || item.filePath || item.filename,
      fileSize: item.file_size,
      numPages: item.num_pages,
      numChunks: item.num_chunks,
      extractedMarkdown: item.extracted_markdown,
      status: item.status,
      ingestedAt: item.ingested_at,
      fileType: item.file_type || 'text',
      usedFallbackEmbeddings: Boolean(item.used_fallback_embeddings),
    }))
  }

  async deleteDocument(docId: string): Promise<{ success: boolean }> {
    if (typeof docId !== 'string' || !docId.trim()) return { success: false }
    const result = await sidecarHttpClient.deleteDocument(docId)
    if (result.success) {
      try {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('ingest:document-deleted', { docId })
          }
        })
      } catch (err: any) {
        logger.log('DEBUG', 'SidecarApp', `Failed broadcasting document deletion event: ${err?.message}`)
      }
    }
    return result
  }

  searchVectorDb(query: string, topK: number = 5, embeddingModel?: string, docIds?: string[]): Promise<any[]> {
    return sidecarHttpClient.searchVectorDb(query, topK, embeddingModel, docIds)
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
      { success: false }
    )
  }

  searchPromptHistory(query: string, topK: number = 10, projectPaths?: string[]): Promise<any[]> {
    if (typeof query !== 'string' || !query.trim()) return Promise.resolve([])
    const payload: Record<string, any> = { query, top_k: topK }
    if (projectPaths && projectPaths.length > 0) payload.project_paths = projectPaths
    return sidecarHttpClient.postJson<any[]>('/history/search', payload, 4000, [])
  }

  removePromptHistoryForSessions(sessionIds: string[]): Promise<{ success: boolean }> {
    if (!sessionIds || sessionIds.length === 0) return Promise.resolve({ success: true })
    return sidecarHttpClient.postJson<{ success: boolean }>(
      '/history/remove',
      { session_ids: sessionIds },
      4000,
      { success: false }
    )
  }

  removePromptHistoryForProject(projectPath: string): Promise<{ success: boolean }> {
    return sidecarHttpClient.postJson<{ success: boolean }>(
      '/history/remove',
      { project_path: projectPath },
      4000,
      { success: false }
    )
  }

  async exportDocument(
    markdownContent: string,
    format: string,
    outputFolder?: string
  ): Promise<{ success: boolean; message?: string; filePath?: string; error?: string }> {
    if (typeof markdownContent !== 'string' || !markdownContent.trim()) {
      return { success: false, error: 'Il contenuto del documento è vuoto.' }
    }

    const cleanFormat = (format || 'pdf').toLowerCase()
    const defaultExt = cleanFormat === 'pdf' ? 'pdf' : cleanFormat === 'docx' ? 'docx' : 'md'
    const generatedFilename = `OnlyRag_Export_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.${defaultExt}`

    try {
      const { app, dialog, shell } = await import('electron')

      let targetPath: string
      if (outputFolder && outputFolder.trim() && documentIoRepository.exists(outputFolder)) {
        targetPath = path.join(outputFolder, generatedFilename)
      } else {
        const saveRes = await dialog.showSaveDialog({
          title: `Esporta Documento (${defaultExt.toUpperCase()})`,
          defaultPath: path.join(app.getPath('downloads'), generatedFilename),
          filters: [
            { name: `${defaultExt.toUpperCase()} Document (*.${defaultExt})`, extensions: [defaultExt] },
            { name: 'Tutti i file (*.*)', extensions: ['*'] },
          ],
        })

        if (saveRes.canceled || !saveRes.filePath) {
          return { success: false, message: "Salvataggio annullato dall'utente." }
        }
        targetPath = saveRes.filePath
      }

      if (defaultExt === 'md') {
        const writeRes = documentIoRepository.writeText(targetPath, markdownContent)
        if (!writeRes.success) {
          return { success: false, error: writeRes.error }
        }
        shell.showItemInFolder(targetPath)
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
        shell.showItemInFolder(targetPath)
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
    } catch (err: any) {
      logger.log('ERROR', 'SidecarApp', `Export exception: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  /**
   * Log analysis diagnostics with dual-engine architecture:
   * Python sidecar first, seamless native Node.js fallback if unavailable.
   */
  async analyzeLogs(extraPaths?: string[]): Promise<SlmLogDiagnosticReport | null> {
    logger.log('INFO', 'SidecarApp', 'Triggering log diagnostics analysis...')
    const res = await sidecarHttpClient.analyzeLogs(extraPaths)

    if (res.success && res.data) {
      logger.log(
        'INFO',
        'SidecarApp',
        `Sidecar log analysis: ${res.data.scanned_files.length} files, ${res.data.anomalies.length} anomalies. Critical: ${res.data.has_critical}`
      )
      return res.data
    }

    const failureReason = !res.success ? res.error : 'unknown sidecar response'
    logger.log(
      'WARN',
      'SidecarApp',
      `Sidecar analysis unavailable (${failureReason}), switching to native Electron log scanner fallback...`
    )
    return this.analyzeLogsNativeFallback(extraPaths)
  }

  /**
   * Native Node.js log diagnostics engine fallback.
   */
  analyzeLogsNativeFallback(extraPaths?: string[]): SlmLogDiagnosticReport {
    const report: SlmLogDiagnosticReport = {
      scanned_files: [],
      total_lines_scanned: 0,
      anomalies: [],
      has_critical: false,
      summary: '',
    }

    const candidatePaths = this.getCandidateLogPaths(extraPaths)
    const logFiles = this.collectLogFiles(candidatePaths)

    const truncatedJsonRe = /(\{|\[)[^}\]]{80,}$/
    const vramPatterns: Array<{ re: RegExp; subType: string; isCritical: boolean }> = [
      { re: /CUDA out of memory|RuntimeError.*CUDA/i, subType: 'CUDA_OOM', isCritical: true },
      { re: /vram.{0,20}(exceeded|full)|out of vram|gpu.*memory.*full/i, subType: 'VRAM_EXCEEDED', isCritical: true },
      { re: /HTTP 504|Gateway Timeout|timed out/i, subType: 'GATEWAY_TIMEOUT', isCritical: false },
      { re: /"response"\s*:\s*""/i, subType: 'EMPTY_RESPONSE', isCritical: false },
      { re: /Ollama(?!_)\w*.*?(timed out|timeout(?!\s*:))|connect.*refused.*11434/i, subType: 'OLLAMA_TIMEOUT', isCritical: false },
      { re: /Circuit breaker tripped|Recursion limit reached|Infinite loop detected/i, subType: 'CIRCUIT_BREAKER', isCritical: true },
      { re: /EPERM: operation not permitted|EACCES: permission denied/i, subType: 'FS_PERMISSIONS', isCritical: false },
    ]
    const toolExtractRe = /"tool_name"\s*:\s*"([^"]+)"/g

    for (const logPath of logFiles) {
      try {
        const raw = fs.readFileSync(logPath, 'utf8')
        const lines = raw.split(/\r?\n/)
        report.scanned_files.push(logPath)
        report.total_lines_scanned += lines.length

        // 1. Truncated JSON
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (truncatedJsonRe.test(line)) {
            report.anomalies.push({
              anomaly_type: 'TRUNCATED_JSON',
              severity: 'ERROR',
              log_file: logPath,
              line_number: i + 1,
              snippet: line.trim().slice(0, 120),
              count: 1,
              remediation: getAnomalyRemediation('TRUNCATED_JSON'),
            })
          }
        }

        // 2. VRAM & Connection Failures
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          for (const pat of vramPatterns) {
            if (pat.re.test(line)) {
              const fullType = `VRAM_THRASH:${pat.subType}`
              report.anomalies.push({
                anomaly_type: fullType,
                severity: pat.isCritical ? 'CRITICAL' : 'ERROR',
                log_file: logPath,
                line_number: i + 1,
                snippet: line.trim().slice(0, 120),
                count: 1,
                remediation: getAnomalyRemediation(fullType),
              })
              break
            }
          }
        }

        // 3. Tool Calling Loops (Sliding Window of 30 lines)
        const windowSize = 30
        const loopThreshold = 3
        const reportedLoops = new Set<string>()

        for (let start = 0; start < lines.length; start++) {
          const window = lines.slice(start, start + windowSize)
          const toolCounts: Record<string, number> = {}

          for (const wline of window) {
            let match: RegExpExecArray | null
            while ((match = toolExtractRe.exec(wline)) !== null) {
              const tool = match[1]
              toolCounts[tool] = (toolCounts[tool] || 0) + 1
            }
          }

          for (const [toolName, count] of Object.entries(toolCounts)) {
            if (count >= loopThreshold) {
              const loopKey = `${start}:${toolName}`
              if (!reportedLoops.has(loopKey)) {
                reportedLoops.add(loopKey)
                report.anomalies.push({
                  anomaly_type: 'TOOL_LOOP',
                  severity: 'CRITICAL',
                  log_file: logPath,
                  line_number: start + 1,
                  snippet: `Tool '${toolName}' chiamato ${count}x in una finestra di ${windowSize} righe.`,
                  count,
                  remediation: getAnomalyRemediation('TOOL_LOOP'),
                })
              }
            }
          }
        }
      } catch (err: any) {
        logger.log('WARN', 'SidecarApp', `Failed reading log file ${logPath}: ${err.message}`)
      }
    }

    report.has_critical = report.anomalies.some((a) => a.severity === 'CRITICAL')
    if (report.anomalies.length === 0) {
      report.summary = 'Nessuna anomalia rilevata — log di sistema puliti.'
    } else {
      const counts: Record<string, number> = {}
      for (const a of report.anomalies) {
        counts[a.anomaly_type] = (counts[a.anomaly_type] || 0) + 1
      }
      report.summary = `Anomalie rilevate — ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}`
    }

    logger.log(
      'INFO',
      'SidecarApp',
      `Native fallback log analysis: ${report.scanned_files.length} files (${report.total_lines_scanned} lines) → ${report.anomalies.length} anomalies.`
    )
    return report
  }

  private getCandidateLogPaths(extraPaths?: string[]): string[] {
    const candidates: string[] = []
    const roaming = process.env.APPDATA
    const local = process.env.LOCALAPPDATA
    const home = os.homedir()

    if (roaming) {
      candidates.push(path.join(roaming, 'onlyrag-v2', 'logs'))
      candidates.push(path.join(roaming, 'OnlyRagV2', 'logs'))
    }
    if (local) {
      candidates.push(path.join(local, 'OnlyRagV2', 'data'))
      candidates.push(path.join(local, 'OnlyRagV2', 'logs'))
      candidates.push(path.join(local, 'onlyrag-v2', 'logs'))
    }
    candidates.push(path.join(home, '.onlyragv2', 'logs'))
    candidates.push(path.join(home, '.onlyragv2', 'data'))
    candidates.push(path.join(process.cwd(), 'logs'))

    if (extraPaths && Array.isArray(extraPaths)) {
      candidates.push(...extraPaths)
    }

    return candidates
  }

  private collectLogFiles(dirs: string[]): string[] {
    const files: string[] = []
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      try {
        const stat = fs.statSync(dir)
        if (stat.isFile()) {
          files.push(dir)
        } else if (stat.isDirectory()) {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const ent of entries) {
            if (ent.isFile() && (ent.name.endsWith('.log') || ent.name.endsWith('.txt'))) {
              files.push(path.join(dir, ent.name))
            }
          }
        }
      } catch (err: any) {
        logger.log('WARN', 'SidecarApp', `Cannot scan log directory ${dir}: ${err.message}`)
      }
    }
    return Array.from(new Set(files))
  }
}

export const sidecarAppService = new SidecarAppService()
