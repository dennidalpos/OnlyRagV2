import http from 'node:http'
import { logger } from '../logging/logger'
import type { VectorSearchResult } from '../../../../shared/types'
import { parseSidecarHealthResponse } from '../../../../shared/domain/sidecarHealth'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

export interface SidecarIngestStreamPayload {
  file_path: string
  task_id: string
  vision_model?: string
  vision_prompt?: string
  normalize_with_llm?: boolean
  normalization_model?: string
  num_ctx?: number
  normalization_think?: boolean
  embedding_model?: string
}

export interface SidecarTranslateStreamPayload {
  source_lang: string
  target_lang: string
  model?: string
  target_dir?: string
  num_ctx?: number
  think?: boolean
  task_id: string
}

/** One entry of GET /documents: metadata only, the Markdown is loaded with GET /documents/{id}. */
export interface SidecarDocumentSummary {
  id: string
  filename: string
  file_path?: string
  filePath?: string
  file_size: number
  num_pages: number
  num_chunks: number
  status: string
  ingested_at: string
  file_type?: string
  used_fallback_embeddings?: boolean
}

export interface SidecarDocumentRecord extends SidecarDocumentSummary {
  extracted_markdown: string
}

export interface SidecarPagePreviewResult {
  docId: string
  pageNumber: number
  totalPages: number
  imageBase64: string
  mimeType: string
}

/** GET /documents/{id}/page-preview/{page}, as the Sidecar serialises it. */
interface SidecarPagePreviewWire {
  doc_id: string
  page_number: number
  total_pages: number
  image_base64: string
  mime_type?: string
}

/** One NDJSON line of a progress stream; `done` carries the result, `error` the failure. */
export interface SidecarStreamEvent {
  type?: string
  data?: unknown
  error?: unknown
  step?: unknown
  [key: string]: unknown
}

/** What a stream endpoint resolves with: the `done` event's data, or why there is none. */
export interface SidecarStreamResult<T> {
  success: boolean
  data?: T
  error?: string
}

type Envelope<T> = { success: true; data: T } | { success: false; error: string }

interface SendOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  timeoutMs: number
  /** Timeout message; defaults to "<path> timed out after <n>ms". */
  timeoutMessage?: string
  /** NDJSON mode: called for every complete line; the unterminated tail is returned as `body`. */
  onLine?: (line: string) => void
  onRequest?: (req: http.ClientRequest) => void
}

interface SendResult {
  status: number
  body: string
}

const DEFAULT_BASE_HOST = 'http://127.0.0.1:8000'
const STREAM_TIMEOUT_MS = 600_000
/** The query embedding may wait for a cold embedding model to load (sidecar read timeout: 60s). */
const VECTOR_SEARCH_TIMEOUT_MS = 65_000

/** FastAPI's `detail` (or an `error` field) from an error body, if it carries one. */
function parseDetail(body: string): string | null {
  try {
    const parsed = JSON.parse(body.trim()) as { detail?: unknown; error?: unknown }
    if (typeof parsed.detail === 'string') return parsed.detail
    if (parsed.detail !== undefined) return JSON.stringify(parsed.detail)
    return typeof parsed.error === 'string' ? parsed.error : null
  } catch {
    return null
  }
}

function errorDetail(status: number, body: string, fallback = `Sidecar error HTTP ${status}`): string {
  const detail = parseDetail(body)
  if (detail) return detail
  return body.trim() ? `${fallback}: ${body.trim().slice(0, 200)}` : fallback
}

export class SidecarHttpClient {
  private baseHost: string
  private authToken = ''
  private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })

  constructor(baseHost: string = DEFAULT_BASE_HOST) {
    this.baseHost = baseHost
  }

  setBaseHost(host?: string) {
    const h = host?.trim()
    this.baseHost = h ? (h.startsWith('http') ? h : `http://${h}`) : DEFAULT_BASE_HOST
  }

  getBaseHost(): string {
    return this.baseHost
  }

  /** Token the sidecar was launched with; sent on every request (the sidecar exempts only /health). */
  setAuthToken(token: string) {
    this.authToken = token
  }

  /** Single transport for every sidecar call: resolves on any HTTP status, rejects on network error or timeout. */
  private send(options: SendOptions): Promise<SendResult> {
    const url = new URL(options.path, this.baseHost)
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
    const headers: http.OutgoingHttpHeaders =
      payload === undefined ? { 'Content-Length': 0 } : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    if (this.authToken) headers['X-OnlyRag-Token'] = this.authToken

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: Number(url.port) || 80,
          path: `${url.pathname}${url.search}`,
          method: options.method,
          agent: this.httpAgent,
          headers,
        },
        (res) => {
          let buffer = ''
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8')
            if (!options.onLine) return
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              if (line.trim()) options.onLine(line.trim())
            }
          })
          res.on('end', () => resolve({ status: res.statusCode || 0, body: buffer }))
          res.on('error', reject)
        },
      )
      req.on('error', reject)
      req.setTimeout(options.timeoutMs, () => {
        req.destroy()
        reject(new Error(options.timeoutMessage || `${options.path} timed out after ${options.timeoutMs}ms`))
      })
      options.onRequest?.(req)
      if (payload !== undefined) req.write(payload)
      req.end()
    })
  }

  /** POSTs to an NDJSON progress endpoint and resolves with the `done` event's data. */
  private async streamNdjson<T>(
    path: string,
    body: unknown,
    label: string,
    onProgress: (event: SidecarStreamEvent) => void,
    onRequest?: (req: http.ClientRequest) => void,
  ): Promise<SidecarStreamResult<T>> {
    let finalResult: T | null = null
    let streamError: string | null = null
    const handleLine = (line: string) => {
      let event: SidecarStreamEvent
      try {
        const parsed: unknown = JSON.parse(line)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
        event = parsed as SidecarStreamEvent
      } catch {
        return
      }
      onProgress(event)
      if (event.type === 'done' && event.data) finalResult = event.data as T
      if (event.type === 'error') streamError = String(event.error || event.step || `${label} failed`)
    }

    try {
      const res = await this.send({
        method: 'POST',
        path,
        body,
        timeoutMs: STREAM_TIMEOUT_MS,
        timeoutMessage: `${label} timed out (10 minute limit)`,
        onLine: handleLine,
        onRequest,
      })
      if (res.status !== 200) {
        const detail = errorDetail(res.status, res.body)
        logger.log('ERROR', 'SidecarClient', `${label} sidecar error: ${detail}`)
        return { success: false, error: detail }
      }
      if (res.body.trim()) handleLine(res.body.trim())
      if (finalResult) return { success: true, data: finalResult }
      if (streamError) return { success: false, error: streamError }
      logger.log('WARN', 'SidecarClient', `${label} stream ended without a done event`)
      return { success: false, error: `${label} stream terminated without completion confirmation` }
    } catch (err: unknown) {
      logger.log('ERROR', 'SidecarClient', `${label} HTTP error: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  }

  private notifyTaskCancellation(taskId: string): void {
    this.send({ method: 'POST', path: `/tasks/cancel?task_id=${encodeURIComponent(taskId)}`, timeoutMs: 5000 }).catch((err) =>
      logger.log('WARN', 'SidecarClient', `Cancellation relay failed: ${err.message}`),
    )
  }

  /** Health / status probe of the sidecar process. */
  async getStatus(timeoutMs = 3000): Promise<{ status: string; [key: string]: unknown }> {
    try {
      const res = await this.send({
        method: 'GET',
        path: '/health',
        timeoutMs,
        timeoutMessage: `Health probe timed out after ${timeoutMs}ms`,
      })
      if (res.status !== 200) return { status: 'offline', error: `HTTP ${res.status || 'unknown'}` }
      let data: ReturnType<typeof parseSidecarHealthResponse> = null
      try {
        data = parseSidecarHealthResponse(JSON.parse(res.body))
      } catch (err: unknown) {
        logger.log('WARN', 'SidecarClient', `Failed to parse /health JSON response: ${errorMessage(err)}`)
      }
      if (!data) return { status: 'offline', error: 'Malformed /health response' }
      return {
        status: data.status,
        engine: data.engine,
        version: data.version,
        documentsCount: data.documents_count,
        chunksCount: data.chunks_count,
      }
    } catch (err: unknown) {
      return { status: 'offline', error: errorMessage(err) }
    }
  }

  /** Streaming file ingestion with NDJSON progress events. */
  ingestFileStream(
    payload: SidecarIngestStreamPayload,
    onProgress: (event: SidecarStreamEvent) => void,
    onCancelRegister?: (cancelFn: () => void) => void,
  ): Promise<SidecarStreamResult<SidecarDocumentRecord>> {
    return this.streamNdjson<SidecarDocumentRecord>(
      '/ingest-path-stream',
      payload,
      'Ingestion',
      onProgress,
      this.cancellableBy(payload.task_id, onCancelRegister),
    )
  }

  /** Streaming in-place document translation with NDJSON progress events; cancellable like ingestion. */
  translateDocumentInplaceStream(
    docId: string,
    payload: SidecarTranslateStreamPayload,
    onProgress: (event: SidecarStreamEvent) => void,
    onCancelRegister?: (cancelFn: () => void) => void,
  ): Promise<SidecarStreamResult<SidecarDocumentRecord>> {
    return this.streamNdjson<SidecarDocumentRecord>(
      `/documents/${encodeURIComponent(docId)}/translate-inplace-stream`,
      payload,
      'Translation',
      onProgress,
      this.cancellableBy(payload.task_id, onCancelRegister),
    )
  }

  /** Cancelling asks the Sidecar to stop the task cooperatively, then drops the stream. */
  private cancellableBy(taskId: string, onCancelRegister?: (cancelFn: () => void) => void) {
    return (req: http.ClientRequest) => {
      onCancelRegister?.(() => {
        this.notifyTaskCancellation(taskId)
        req.destroy()
      })
    }
  }

  /** Replaces a document's markdown and re-indexes it. */
  async updateDocument(docId: string, markdownContent: string, embeddingModel?: string): Promise<SidecarStreamResult<SidecarDocumentRecord>> {
    const result = await this.requestJson<SidecarDocumentRecord>(
      'PUT',
      `/documents/${encodeURIComponent(docId)}`,
      { markdown_content: markdownContent, embedding_model: embeddingModel || undefined },
      60_000,
    )
    return result.success ? result : { success: false, error: result.error }
  }

  /** Pre-rendered bitmap preview of one document page, or null when unavailable. */
  async getDocumentPagePreview(docId: string, pageNumber: number): Promise<SidecarPagePreviewResult | null> {
    const page = Math.max(1, Number(pageNumber) || 1)
    const result = await this.requestJson<SidecarPagePreviewWire>('GET', `/documents/${encodeURIComponent(docId)}/page-preview/${page}`, undefined, 5000)
    if (!result.success) {
      logger.log('DEBUG', 'SidecarClient', `Page preview unavailable for doc ${docId} page ${page}: ${result.error}`)
      return null
    }
    const data = result.data
    return {
      docId: data.doc_id,
      pageNumber: data.page_number,
      totalPages: data.total_pages,
      imageBase64: data.image_base64,
      mimeType: data.mime_type || 'image/png',
    }
  }

  /** Lists all indexed documents; null when unreachable, so callers can tell a network failure from an empty library. */
  async listDocuments(): Promise<SidecarDocumentSummary[] | null> {
    const result = await this.requestJson<SidecarDocumentSummary[]>('GET', '/documents', undefined, 5000)
    if (result.success) return result.data
    if (!result.error.includes('ECONNREFUSED')) {
      logger.log('WARN', 'SidecarClient', `Failed requesting /documents: ${result.error}`)
    }
    return null
  }

  /** One document with its extracted Markdown; null when it does not exist or the sidecar is unreachable. */
  async getDocument(docId: string): Promise<SidecarDocumentRecord | null> {
    const result = await this.requestJson<SidecarDocumentRecord>('GET', `/documents/${encodeURIComponent(docId)}`, undefined, 10_000)
    return result.success ? result.data : null
  }

  /** Deletes a document and all its embedded chunks from LanceDB. */
  async deleteDocument(docId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await this.send({
        method: 'DELETE',
        path: `/documents/${encodeURIComponent(docId)}`,
        timeoutMs: 5000,
        timeoutMessage: 'Eliminazione scaduta dopo 5 secondi. Verifica il Sidecar e riprova.',
      })
      if (res.status === 200) return { success: true }
      return { success: false, error: parseDetail(res.body) || `Il Sidecar ha rifiutato l'eliminazione (HTTP ${res.status || 'sconosciuto'}).` }
    } catch (err: unknown) {
      logger.log('ERROR', 'SidecarClient', `Failed deleting document ${docId}: ${errorMessage(err)}`)
      const timedOut = errorMessage(err).startsWith('Eliminazione scaduta')
      return { success: false, error: timedOut ? errorMessage(err) : `Sidecar non raggiungibile: ${errorMessage(err)}` }
    }
  }

  /**
   * Hybrid vector search over indexed chunks. Rejects on failure so callers can tell
   * "no matches" from "search unavailable"; the sidecar embeds the query with each chunk's own model.
   */
  async searchVectorDb(query: string, topK: number = 5, docIds?: string[]): Promise<VectorSearchResult[]> {
    if (typeof query !== 'string' || !query.trim()) return []
    const payload: Record<string, unknown> = { query, top_k: topK }
    if (docIds && docIds.length > 0) payload.doc_ids = docIds
    const result = await this.requestJson<VectorSearchResult[]>('POST', '/vector/search', payload, VECTOR_SEARCH_TIMEOUT_MS)
    if (!result.success) throw new Error(`Vector search failed: ${result.error}`)
    return result.data
  }

  /** POST JSON returning `fallback` on any failure; for best-effort calls. */
  async postJson<T>(urlPath: string, payload: unknown, timeoutMs: number = 5000, fallback: T): Promise<T> {
    const result = await this.requestJson<T>('POST', urlPath, payload, timeoutMs)
    return result.success ? result.data : fallback
  }

  /** POST JSON returning a `{ success, data, error }` envelope. */
  postJsonEnvelope<T>(urlPath: string, payload: unknown, timeoutMs: number = 15_000): Promise<Envelope<T>> {
    return this.requestJson<T>('POST', urlPath, payload, timeoutMs)
  }

  private async requestJson<T>(method: SendOptions['method'], urlPath: string, body: unknown, timeoutMs: number): Promise<Envelope<T>> {
    let res: SendResult
    try {
      res = await this.send({ method, path: urlPath, body, timeoutMs })
    } catch (err: unknown) {
      logger.log('ERROR', 'SidecarClient', `${urlPath} request failed: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err).includes('timed out') ? errorMessage(err) : `Sidecar connection error: ${errorMessage(err)}` }
    }
    if (res.status < 200 || res.status >= 300) {
      const detail = errorDetail(res.status, res.body, `HTTP ${res.status}`)
      logger.log('ERROR', 'SidecarClient', `Non-2xx from ${urlPath}: ${detail}`)
      return { success: false, error: detail }
    }
    try {
      return { success: true, data: JSON.parse(res.body) as T }
    } catch (err: unknown) {
      logger.log('ERROR', 'SidecarClient', `JSON parse error on ${urlPath}: ${errorMessage(err)}`)
      return { success: false, error: `Response parse error: ${errorMessage(err)}` }
    }
  }

  /** Export markdown to PDF / DOCX via /export. */
  async exportDocument(markdownContent: string, format: string): Promise<SidecarStreamResult<{ base64_content?: string }>> {
    return await this.postJsonEnvelope<{ base64_content?: string }>('/export', { markdown_content: markdownContent, export_format: format }, 30_000)
  }
}

export const sidecarHttpClient = new SidecarHttpClient()
