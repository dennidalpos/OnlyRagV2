import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { BrowserWindow } from 'electron'
import { logger } from '../../diagnostics'
import { sidecarProcessManager } from '../infrastructure/process/sidecarProcessManager'
import { taskRunner } from '../infrastructure/process/taskRunner'

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })

export class SidecarAppService {
  getStatus() {
    return new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:8000/health', { agent: httpAgent, timeout: 3000 }, (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          try {
            const data = JSON.parse(raw)
            resolve(data)
          } catch (err: any) {
            logger.log('WARN', 'SidecarApp', `Failed to parse /health JSON response: ${err.message}`)
            resolve({ status: 'offline' })
          }
        })
      })
      req.on('error', () => {
        resolve({ status: 'offline' })
      })
      req.on('timeout', () => {
        req.destroy()
        resolve({ status: 'offline' })
      })
    })
  }

  async restartSidecar() {
    logger.log('INFO', 'SidecarApp', 'User requested Sidecar restart...')
    const isOnline = await sidecarProcessManager.restartPythonSidecar()
    return { success: isOnline, message: isOnline ? 'Sidecar engine restarted successfully.' : 'Failed to restart Sidecar.' }
  }

  ingestFile(filePath: string) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return Promise.resolve({ success: false, error: 'Invalid file path' })
    }
    logger.log('INFO', 'SidecarApp', `Ingesting file path (streaming): ${filePath}`)
    try {
      const resolvedPath = path.resolve(filePath)
      if (!fs.existsSync(resolvedPath)) {
        return Promise.resolve({ success: false, error: 'File does not exist on disk' })
      }

      const postData = JSON.stringify({ file_path: resolvedPath })
      const taskId = `ingest-${Date.now()}`

      return new Promise((resolve) => {
        const req = http.request(
          'http://127.0.0.1:8000/ingest-path-stream',
          {
            method: 'POST',
            agent: httpAgent,
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
              buffer = lines.pop() || '' // keep last incomplete line

              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed) continue
                try {
                  const event = JSON.parse(trimmed)
                  // Broadcast live progress to renderer
                  BrowserWindow.getAllWindows().forEach((win) => {
                    if (!win.isDestroyed()) {
                      win.webContents.send('ingest:stream-progress', event)
                    }
                  })

                  if (event.type === 'done' && event.data) {
                    finalResult = event.data
                  }
                } catch {
                  // ignore partial parse errors
                }
              }
            })

            res.on('end', () => {
              taskRunner.unregisterActiveTask(taskId)
              if (res.statusCode === 200) {
                if (buffer.trim()) {
                  try {
                    const event = JSON.parse(buffer.trim())
                    if (event.type === 'done' && event.data) {
                      finalResult = event.data
                    }
                  } catch (err: any) {
                    logger.log('DEBUG', 'SidecarApp', `Trailing buffer was not SSE JSON: ${err?.message}`)
                  }
                }

                if (finalResult) {
                  const filename = path.basename(resolvedPath)
                  resolve({
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
                    },
                  })
                } else {
                  logger.log('WARN', 'SidecarApp', 'Stream ended without explicit done event, attempting fallback')
                  resolve({ success: false, error: 'Ingestion stream terminated without completion confirmation' })
                }
              } else {
                logger.log('ERROR', 'SidecarApp', `Sidecar streaming error HTTP ${res.statusCode}`)
                resolve({ success: false, error: `Sidecar error HTTP ${res.statusCode}` })
              }
            })
          }
        )

        taskRunner.registerActiveTask(taskId, 'ingestion', () => {
          try {
            req.destroy()
          } catch (cancelErr: any) {
            logger.log('WARN', 'SidecarApp', `Task cancel error: ${cancelErr.message}`)
          }
        }, resolvedPath)

        req.on('error', (err) => {
          taskRunner.unregisterActiveTask(taskId)
          logger.log('ERROR', 'SidecarApp', `Ingestion HTTP error: ${err.message}`)
          resolve({ success: false, error: err.message })
        })
        req.setTimeout(600000, () => {
          taskRunner.unregisterActiveTask(taskId)
          req.destroy()
          logger.log('ERROR', 'SidecarApp', 'Ingestion timed out (10 minute limit)')
          resolve({ success: false, error: 'Ingestion timed out (10 minute limit)' })
        })
        req.write(postData)
        req.end()
      })
    } catch (err: any) {
      logger.log('ERROR', 'SidecarApp', `Unexpected ingestion exception: ${err.message}`)
      return Promise.resolve({ success: false, error: err.message })
    }
  }

  updateDocument(docId: string, markdownContent: string) {
    if (!docId || typeof docId !== 'string') {
      return Promise.resolve({ success: false, error: 'Invalid document ID' })
    }
    logger.log('INFO', 'SidecarApp', `Updating document: ${docId}`)
    const postData = JSON.stringify({ markdown_content: markdownContent })

    return new Promise((resolve) => {
      const req = http.request(
        `http://127.0.0.1:8000/documents/${encodeURIComponent(docId)}`,
        {
          method: 'PUT',
          agent: httpAgent,
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
                resolve({
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
                    fileType: data.filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text',
                  },
                })
              } catch (parseErr: any) {
                logger.log('ERROR', 'SidecarApp', `Failed parsing update response: ${parseErr.message}`)
                resolve({ success: false, error: 'Failed parsing response from sidecar' })
              }
            } else {
              let detail = `Error HTTP ${res.statusCode}`
              try {
                const parsed = JSON.parse(raw)
                if (parsed.detail) detail = parsed.detail
              } catch (err: any) {
                logger.log('DEBUG', 'SidecarApp', `Sidecar error response was not JSON: ${err?.message}`)
              }
              resolve({ success: false, error: detail })
            }
          })
        }
      )
      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarApp', `Update document HTTP error: ${err.message}`)
        resolve({ success: false, error: err.message })
      })
      req.setTimeout(60000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarApp', 'Document update timed out (60s)')
        resolve({ success: false, error: 'Document update timed out' })
      })
      req.write(postData)
      req.end()
    })
  }

  getDocumentPagePreview(docId: string, pageNumber: number) {
    if (!docId || typeof docId !== 'string') return Promise.resolve(null)
    const page = Math.max(1, Number(pageNumber) || 1)
    return new Promise((resolve) => {
      const req = http.get(
        `http://127.0.0.1:8000/documents/${encodeURIComponent(docId)}/page-preview/${page}`,
        { agent: httpAgent, timeout: 5000 },
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
                logger.log('WARN', 'SidecarApp', `Failed parsing page preview JSON for ${docId}: ${parseErr.message}`)
                resolve(null)
              }
            } else {
              logger.log('DEBUG', 'SidecarApp', `Page preview HTTP ${res.statusCode} for doc ${docId} page ${page}`)
              resolve(null)
            }
          })
        }
      )
      req.on('error', (err) => {
        logger.log('WARN', 'SidecarApp', `Failed page preview request for ${docId}: ${err.message}`)
        resolve(null)
      })
      req.setTimeout(5000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarApp', `Page preview request timed out (5s) for ${docId}`)
        resolve(null)
      })
    })
  }

  listIngestedDocuments() {
    return new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:8000/documents', { agent: httpAgent, timeout: 5000 }, (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          try {
            const data = JSON.parse(raw)
            resolve(
              data.map((item: any) => ({
                id: item.id,
                filename: item.filename,
                filePath: item.filePath || item.filename,
                fileSize: item.file_size,
                numPages: item.num_pages,
                numChunks: item.num_chunks,
                extractedMarkdown: item.extracted_markdown,
                status: item.status,
                ingestedAt: item.ingested_at,
                fileType: item.file_type || 'text',
              }))
            )
          } catch (parseErr: any) {
            logger.log('ERROR', 'SidecarApp', `Failed parsing /documents list: ${parseErr.message}`)
            resolve([])
          }
        })
      })
      req.on('error', (err: any) => {
        if (err?.message && !err.message.includes('ECONNREFUSED')) {
          logger.log('WARN', 'SidecarApp', `Failed requesting /documents: ${err.message}`)
        }
        resolve([])
      })
      req.setTimeout(5000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarApp', 'Listing documents timed out (5s)')
        resolve([])
      })
    })
  }

  deleteDocument(docId: string) {
    if (typeof docId !== 'string' || !docId.trim()) return Promise.resolve({ success: false })
    return new Promise((resolve) => {
      const req = http.request(
        `http://127.0.0.1:8000/documents/${encodeURIComponent(docId)}`,
        { method: 'DELETE', agent: httpAgent, timeout: 5000 },
        (res) => {
          const isSuccess = res.statusCode === 200
          if (isSuccess) {
            try {
              const { BrowserWindow } = require('electron')
              BrowserWindow.getAllWindows().forEach((win: any) => {
                if (!win.isDestroyed()) {
                  win.webContents.send('ingest:document-deleted', { docId })
                }
              })
            } catch (err: any) {
              logger.log('DEBUG', 'SidecarApp', `Failed broadcasting document deletion event: ${err?.message}`)
            }
          }
          resolve({ success: isSuccess })
        }
      )
      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarApp', `Failed deleting document ${docId}: ${err.message}`)
        resolve({ success: false })
      })
      req.setTimeout(5000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarApp', `Deleting document ${docId} timed out`)
        resolve({ success: false })
      })
      req.end()
    })
  }

  searchVectorDb(query: string, topK: number = 5, embeddingModel?: string, docIds?: string[]) {
    if (typeof query !== 'string' || !query.trim()) return Promise.resolve([])
    return new Promise((resolve) => {
      const payload: Record<string, any> = {
        query,
        top_k: topK,
        embedding_model: embeddingModel || 'nomic-embed-text',
      }
      if (docIds && docIds.length > 0) {
        payload.doc_ids = docIds
      }
      const postData = JSON.stringify(payload)
      const req = http.request(
        'http://127.0.0.1:8000/vector/search',
        {
          method: 'POST',
          agent: httpAgent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let raw = ''
          res.on('data', (chunk) => {
            raw += chunk
          })
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw))
            } catch (parseErr: any) {
              logger.log('ERROR', 'SidecarApp', `Failed parsing /vector/search response: ${parseErr.message}`)
              resolve([])
            }
          })
        }
      )
      req.on('error', (err) => {
        logger.log('ERROR', 'SidecarApp', `Vector search request failed: ${err.message}`)
        resolve([])
      })
      req.setTimeout(4000, () => {
        req.destroy()
        logger.log('WARN', 'SidecarApp', 'Vector search timed out (4s)')
        resolve([])
      })
      req.write(postData)
      req.end()
    })
  }

  async exportDocument(markdownContent: string, format: string): Promise<{ success: boolean; message?: string; filePath?: string; error?: string }> {
    if (typeof markdownContent !== 'string' || !markdownContent.trim()) {
      return { success: false, error: 'Il contenuto del documento è vuoto.' }
    }

    const cleanFormat = (format || 'pdf').toLowerCase()
    const defaultExt = cleanFormat === 'pdf' ? 'pdf' : (cleanFormat === 'docx' ? 'docx' : 'md')

    try {
      const { app, dialog, shell } = await import('electron')
      const saveRes = await dialog.showSaveDialog({
        title: `Esporta Documento (${defaultExt.toUpperCase()})`,
        defaultPath: path.join(
          app.getPath('downloads'),
          `OnlyRag_Export_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.${defaultExt}`
        ),
        filters: [
          { name: `${defaultExt.toUpperCase()} Document (*.${defaultExt})`, extensions: [defaultExt] },
          { name: 'Tutti i file (*.*)', extensions: ['*'] },
        ],
      })

      if (saveRes.canceled || !saveRes.filePath) {
        return { success: false, message: 'Salvataggio annullato dall\'utente.' }
      }

      const targetPath = saveRes.filePath

      // If format is markdown or text, we can save immediately
      if (defaultExt === 'md') {
        fs.writeFileSync(targetPath, markdownContent, 'utf-8')
        shell.showItemInFolder(targetPath)
        logger.log('INFO', 'SidecarApp', `Markdown document exported successfully to: ${targetPath}`)
        return { success: true, message: `Documento Markdown salvato con successo: ${path.basename(targetPath)}`, filePath: targetPath }
      }

      // For PDF / DOCX, request compilation from Python sidecar
      const postData = JSON.stringify({ markdown_content: markdownContent, export_format: cleanFormat })
      const sidecarRes: any = await new Promise((resolve) => {
        const req = http.request(
          'http://127.0.0.1:8000/export',
          {
            method: 'POST',
            agent: httpAgent,
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
                  logger.log('ERROR', 'SidecarApp', `Failed parsing export response: ${parseErr.message}`)
                  resolve({ success: false, error: 'Export failed: Invalid JSON response' })
                }
              } else {
                let errDetail = `Export error HTTP ${res.statusCode}`
                try {
                  const parsedErr = JSON.parse(raw)
                  if (parsedErr.detail) errDetail = parsedErr.detail
                } catch (err: any) {
                  logger.log('DEBUG', 'SidecarApp', `Export error response was not JSON: ${err?.message}`)
                }
                logger.log('ERROR', 'SidecarApp', errDetail)
                resolve({ success: false, error: errDetail })
              }
            })
          }
        )
        req.on('error', (err) => {
          logger.log('ERROR', 'SidecarApp', `Export HTTP error: ${err.message}`)
          resolve({ success: false, error: `Sidecar error: ${err.message}` })
        })
        req.setTimeout(30000, () => {
          req.destroy()
          logger.log('WARN', 'SidecarApp', 'Export operation timed out (30s)')
          resolve({ success: false, error: 'Export timed out' })
        })
        req.write(postData)
        req.end()
      })

      if (sidecarRes.success && sidecarRes.data?.base64_content) {
        const fileBuffer = Buffer.from(sidecarRes.data.base64_content, 'base64')
        fs.writeFileSync(targetPath, fileBuffer)
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
}

export const sidecarAppService = new SidecarAppService()
