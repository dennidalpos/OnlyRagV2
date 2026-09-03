/**
 * electron/core/infrastructure/http/sidecarHttpClient.ts
 *
 * Infrastructure Layer — Dedicated HTTP transport client for the Python FastAPI Sidecar (:8000).
 *
 * Centralizes all low-level network I/O, keep-alive agent pooling, timeouts, SSE line-parsing,
 * and error formatting for communication with the sidecar engine.
 */

import http from 'node:http'
import { logger } from '../../../diagnostics'
import type { SlmLogDiagnosticReport } from '../../../../shared/types'

export interface SidecarIngestStreamPayload {
  file_path: string
  vision_model?: string
  vision_prompt?: string
  normalize_with_llm?: boolean
  normalization_model?: string
  num_ctx?: number
}

export interface SidecarTranslateStreamPayload {
  source_lang: string
  target_lang: string
  model?: string
  backup_original?: boolean
  target_dir?: string
  num_ctx?: number
}

export interface SidecarDocumentRecord {
  id: string
  filename: string
  file_path?: string
  filePath?: string
  file_size: number
  num_pages: number
  num_chunks: number
  extracted_markdown: string
  status: string
  ingested_at: string
  file_type?: string
  used_fallback_embeddings?: boolean
}

export interface SidecarPagePreviewResult {
  docId: string
  pageNumber: number
  totalPages: number
  imageBase64: string
  mimeType: string
}

export class SidecarHttpClient {
  private baseHost: string = 'http://127.0.0.1:8000'
  private httpAgent: http.Agent

  constructor(baseHost: string = 'http://127.0.0.1:8000') {
    this.baseHost = baseHost
    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })
  }

  setBaseHost(host?: string) {
    if (host && host.trim()) {
      const h = host.trim()
      this.baseHost = h.startsWith('http') ? h : `http://${h}`
    } else {
      this.baseHost = 'http://127.0.0.1:8000'
    }
  }

  getBaseHost(): string {
    return this.baseHost
  }

  private resolveUrl(urlPath: string): { hostname: string; port: number; path: string } {
    const url = new URL(urlPath, this.baseHost)
    return {
      hostname: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
    }
  }

  /**
   * Health / Status probe of the sidecar process.
   */
  getStatus(): Promise<{ status: string; [key: string]: any }> {
    const urlOpts = this.resolveUrl('/health')
    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          agent: this.httpAgent,
          timeout: 3000,
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => { raw += chunk })
          res.on('end', () => {
            try {
              const data = JSON.parse(raw)
              resolve(data)
            } catch (err: any) {
              logger.log('WARN', 'SidecarClient', `Failed to parse /health JSON response: ${err.message}`)
              resolve({ status: 'offline' })
            }
          })
        }
      )
      req.on('error', () => {
        resolve({ status: 'offline' })
      })
      req.setTimeout(3000, () => {
        req.destroy()
        resolve({ status: 'offline' })
      })
    })
  }

  /**
   * Streaming file ingestion with real-time SSE progress events.
   */
  ingestFileStream(
    payload: SidecarIngestStreamPayload,
    onProgress: (event: any) => void,
    onCancelRegister?: (cancelFn: () => void) => void
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const urlOpts = this.resolveUrl('/ingest-path-stream')
    const postData = JSON.stringify(payload)

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: this.httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let buffer = ''
          let finalResult: any = null

          res.on('data', (chunk) => {
            buffer += chunk.toString('utf-8')
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) continue
              try {
                const event = JSON.parse(trimmed)
                onProgress(event)
                if (event.type === 'done' && event.data) {
                  finalResult = event.data
                }
              } catch {
                // ignore partial chunk parse errors
              }
            }
          })

          res.on('end', () => {
            if (res.statusCode === 200) {
              if (buffer.trim()) {
                try {
                  const event = JSON.parse(buffer.trim())
                  if (event.type === 'done' && event.data) {
                    finalResult = event.data
                  }
                } catch (err: any) {
                  logger.log('DEBUG', 'SidecarClient', `Trailing buffer was not SSE JSON: ${err?.message}`)
                }
              }

              if (finalResult) {
                resolve({ success: true, data: finalResult })
              } else {
                logger.log('WARN', 'SidecarClient', 'Stream ended without explicit done event')
                resolve({ success: false, error: 'Ingestion stream terminated without completion confirmation' })
              }
            } else {
              let errorDetail = `Sidecar error HTTP ${res.statusCode}`
              if (buffer.trim()) {
                try {
                  const parsed = JSON.parse(buffer.trim())
                  if (parsed.detail) {
                    errorDetail = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail)
                  } else if (parsed.error) {
                    errorDetail = parsed.error
                  }
                } catch {
                  errorDetail = `${errorDetail}: ${buffer.trim().slice(0, 200)}`
                }
              }
              logger.log('ERROR', 'SidecarClient', `Sidecar streaming error: ${errorDetail}`)
              resolve({ success: false, error: errorDetail })
            }
          })
        }
      )

      if (onCancelRegister) {
        onCancelRegister(() => {
          try {
            req.destroy()
          } catch (cancelErr: any) {
            logger.log('WARN', 'SidecarClient', `Task cancel error: ${cancelErr.message}`)
          }
        })
      }

      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarClient', `Ingestion HTTP error: ${err.message}`)
        resolve({ success: false, error: err.message })
      })

      req.setTimeout(600_000, () => {
        req.destroy()
        logger.log('ERROR', 'SidecarClient', 'Ingestion timed out (10 minute limit)')
        resolve({ success: false, error: 'Ingestion timed out (10 minute limit)' })
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * Update markdown content and re-index a document.
   */
  updateDocument(docId: string, markdownContent: string): Promise<{ success: boolean; data?: any; error?: string }> {
    const urlOpts = this.resolveUrl(`/documents/${encodeURIComponent(docId)}`)
    const postData = JSON.stringify({ markdown_content: markdownContent })

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'PUT',
          agent: this.httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => { raw += chunk })
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const data = JSON.parse(raw)
                resolve({ success: true, data })
              } catch (parseErr: any) {
                logger.log('ERROR', 'SidecarClient', `Failed parsing update response: ${parseErr.message}`)
                resolve({ success: false, error: 'Failed parsing response from sidecar' })
              }
            } else {
              let detail = `Error HTTP ${res.statusCode}`
              try {
                const parsed = JSON.parse(raw)
                if (parsed.detail) detail = parsed.detail
              } catch (err: any) {
                logger.log('DEBUG', 'SidecarClient', `Sidecar error response was not JSON: ${err?.message}`)
              }
              resolve({ success: false, error: detail })
            }
          })
        }
      )

      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarClient', `Update document HTTP error: ${err.message}`)
        resolve({ success: false, error: err.message })
      })

      req.setTimeout(60_000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarClient', 'Document update timed out (60s)')
        resolve({ success: false, error: 'Document update timed out' })
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * Streaming document translation in-place with real-time SSE progress events.
   */
  translateDocumentInplaceStream(
    docId: string,
    payload: SidecarTranslateStreamPayload,
    onProgress: (event: any) => void
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const urlOpts = this.resolveUrl(`/documents/${encodeURIComponent(docId)}/translate-inplace-stream`)
    const postData = JSON.stringify(payload)

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: this.httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let buffer = ''
          let finalResult: any = null

          res.on('data', (chunk) => {
            buffer += chunk.toString('utf-8')
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) continue
              try {
                const event = JSON.parse(trimmed)
                onProgress(event)
                if (event.type === 'done' && event.data) {
                  finalResult = event.data
                }
              } catch {
                // ignore partial JSON parse errors
              }
            }
          })

          res.on('end', () => {
            if (res.statusCode === 200) {
              if (buffer.trim()) {
                try {
                  const event = JSON.parse(buffer.trim())
                  if (event.type === 'done' && event.data) {
                    finalResult = event.data
                  }
                } catch (err: any) {
                  logger.log('DEBUG', 'SidecarClient', `Trailing translate buffer was not JSON: ${err?.message}`)
                }
              }

              if (finalResult) {
                resolve({ success: true, data: finalResult })
              } else {
                logger.log('WARN', 'SidecarClient', 'Translation stream ended without explicit done event')
                resolve({ success: false, error: 'Translation stream terminated unexpectedly' })
              }
            } else {
              let errorDetail = `Sidecar error HTTP ${res.statusCode}`
              if (buffer.trim()) {
                try {
                  const parsed = JSON.parse(buffer.trim())
                  if (parsed.detail) {
                    errorDetail = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail)
                  } else if (parsed.error) {
                    errorDetail = parsed.error
                  }
                } catch {
                  errorDetail = `${errorDetail}: ${buffer.trim().slice(0, 200)}`
                }
              }
              logger.log('ERROR', 'SidecarClient', `Translation sidecar error: ${errorDetail}`)
              resolve({ success: false, error: errorDetail })
            }
          })
        }
      )

      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarClient', `Translate in place HTTP error: ${err.message}`)
        resolve({ success: false, error: err.message })
      })

      req.setTimeout(600_000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarClient', 'Translate in place timed out (10 min)')
        resolve({ success: false, error: 'Translation timed out' })
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * Get pre-rendered bitmap preview of a specific document page.
   */
  getDocumentPagePreview(docId: string, pageNumber: number): Promise<SidecarPagePreviewResult | null> {
    const page = Math.max(1, Number(pageNumber) || 1)
    const urlOpts = this.resolveUrl(`/documents/${encodeURIComponent(docId)}/page-preview/${page}`)

    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          agent: this.httpAgent,
          timeout: 5000,
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => { raw += chunk })
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const data = JSON.parse(raw)
                resolve({
                  docId: data.doc_id,
                  pageNumber: data.page_number,
                  totalPages: data.total_pages,
                  imageBase64: data.image_base64,
                  mimeType: data.mime_type || 'image/png',
                })
              } catch (parseErr: any) {
                logger.log('WARN', 'SidecarClient', `Failed parsing page preview JSON for ${docId}: ${parseErr.message}`)
                resolve(null)
              }
            } else {
              logger.log('DEBUG', 'SidecarClient', `Page preview HTTP ${res.statusCode} for doc ${docId} page ${page}`)
              resolve(null)
            }
          })
        }
      )

      req.on('error', (err) => {
        logger.log('WARN', 'SidecarClient', `Failed page preview request for ${docId}: ${err.message}`)
        resolve(null)
      })

      req.setTimeout(5000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarClient', `Page preview request timed out (5s) for ${docId}`)
        resolve(null)
      })
    })
  }

  /**
   * Lists all indexed documents. Resolves null when unreachable so callers can distinguish
   * network failure from an empty library.
   */
  listDocuments(): Promise<SidecarDocumentRecord[] | null> {
    const urlOpts = this.resolveUrl('/documents')
    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          agent: this.httpAgent,
          timeout: 5000,
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => { raw += chunk })
          res.on('end', () => {
            try {
              const data = JSON.parse(raw)
              resolve(data)
            } catch (parseErr: any) {
              logger.log('ERROR', 'SidecarClient', `Failed parsing /documents list: ${parseErr.message}`)
              resolve(null)
            }
          })
        }
      )

      req.on('error', (err: any) => {
        if (err?.message && !err.message.includes('ECONNREFUSED')) {
          logger.log('WARN', 'SidecarClient', `Failed requesting /documents: ${err.message}`)
        }
        resolve(null)
      })

      req.setTimeout(5000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarClient', 'Listing documents timed out (5s)')
        resolve(null)
      })
    })
  }

  /**
   * Deletes a document and all its embedded chunks from LanceDB.
   */
  deleteDocument(docId: string): Promise<{ success: boolean }> {
    const urlOpts = this.resolveUrl(`/documents/${encodeURIComponent(docId)}`)
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'DELETE',
          agent: this.httpAgent,
          timeout: 5000,
        },
        (res) => {
          resolve({ success: res.statusCode === 200 })
        }
      )

      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarClient', `Failed deleting document ${docId}: ${err.message}`)
        resolve({ success: false })
      })

      req.setTimeout(5000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarClient', `Deleting document ${docId} timed out`)
        resolve({ success: false })
      })

      req.end()
    })
  }

  /**
   * Hybrid / Dense vector search over indexed chunks.
   */
  searchVectorDb(query: string, topK: number = 5, embeddingModel?: string, docIds?: string[]): Promise<any[]> {
    if (typeof query !== 'string' || !query.trim()) return Promise.resolve([])
    const payload: Record<string, any> = {
      query,
      top_k: topK,
      embedding_model: embeddingModel || 'nomic-embed-text',
    }
    if (docIds && docIds.length > 0) {
      payload.doc_ids = docIds
    }
    return this.postJson<any[]>('/vector/search', payload, 4000, [])
  }

  /**
   * Generic POST JSON helper with timeout, error handling, and safe fallback.
   */
  postJson<T>(urlPath: string, payload: unknown, timeoutMs: number = 5000, fallback: T): Promise<T> {
    const urlOpts = this.resolveUrl(urlPath)
    const postData = JSON.stringify(payload)

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: this.httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => { raw += chunk })
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(raw) as T)
              } catch (parseErr: any) {
                logger.log('ERROR', 'SidecarClient', `JSON parse error on ${urlPath}: ${parseErr.message}`)
                resolve(fallback)
              }
            } else {
              logger.log('ERROR', 'SidecarClient', `Non-2xx HTTP ${res.statusCode} from ${urlPath}`)
              resolve(fallback)
            }
          })
        }
      )

      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarClient', `${urlPath} request failed: ${err.message}`)
        resolve(fallback)
      })

      req.setTimeout(timeoutMs, () => {
        req.destroy()
        logger.log('WARN', 'SidecarClient', `${urlPath} timed out after ${timeoutMs}ms`)
        resolve(fallback)
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * Typed POST JSON that returns a structured result envelope { success, data, error }.
   */
  postJsonEnvelope<T>(
    urlPath: string,
    payload: unknown,
    timeoutMs: number = 15_000
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
    const urlOpts = this.resolveUrl(urlPath)
    const postData = JSON.stringify(payload)

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: urlOpts.hostname,
          port: urlOpts.port,
          path: urlOpts.path,
          method: 'POST',
          agent: this.httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => { raw += chunk })
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve({ success: true, data: JSON.parse(raw) as T })
              } catch (parseErr: any) {
                logger.log('ERROR', 'SidecarClient', `JSON parse error on ${urlPath}: ${parseErr.message}`)
                resolve({ success: false, error: `Response parse error: ${parseErr.message}` })
              }
            } else {
              let detail = `HTTP ${res.statusCode}`
              try { detail = JSON.parse(raw)?.detail || detail } catch { /* ignore */ }
              logger.log('ERROR', 'SidecarClient', `Non-2xx from ${urlPath}: ${detail}`)
              resolve({ success: false, error: detail })
            }
          })
        }
      )

      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarClient', `HTTP error on ${urlPath}: ${err.message}`)
        resolve({ success: false, error: `Sidecar connection error: ${err.message}` })
      })

      req.setTimeout(timeoutMs, () => {
        req.destroy()
        logger.log('WARN', 'SidecarClient', `Request to ${urlPath} timed out after ${timeoutMs}ms`)
        resolve({ success: false, error: `Request timed out after ${timeoutMs}ms` })
      })

      req.write(postData)
      req.end()
    })
  }

  /**
   * Log analysis diagnostics via FastAPI sidecar endpoint /agent/logs/analyze.
   */
  analyzeLogs(extraPaths?: string[]): Promise<{ success: true; data: SlmLogDiagnosticReport } | { success: false; error: string }> {
    return this.postJsonEnvelope<SlmLogDiagnosticReport>(
      '/agent/logs/analyze',
      { extra_paths: extraPaths ?? [] },
      15_000
    )
  }

  /**
   * Export markdown to PDF / DOCX via Python sidecar /export endpoint.
   */
  exportDocument(markdownContent: string, format: string): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.postJsonEnvelope<any>(
      '/export',
      { markdown_content: markdownContent, export_format: format },
      30_000
    )
  }
}

export const sidecarHttpClient = new SidecarHttpClient()
