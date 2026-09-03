import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { SidecarHttpClient } from './sidecarHttpClient'

function createMockServer(routes: Array<{ method: string; path: string; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void }>) {
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    const server = http.createServer((req, res) => {
      const route = routes.find((r) => r.method === req.method && (req.url || '').startsWith(r.path))
      if (route) {
        route.handler(req, res)
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Not found' }))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` })
    })
  })
}

describe('SidecarHttpClient Unit Tests', () => {
  let server: http.Server
  let client: SidecarHttpClient

  beforeAll(async () => {
    const mock = await createMockServer([
      {
        method: 'GET',
        path: '/health',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'online', version: '2.3.0' }))
        },
      },
      {
        method: 'GET',
        path: '/documents',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify([{ id: 'doc-1', filename: 'report.pdf', file_size: 1024, num_pages: 2, num_chunks: 5, extracted_markdown: '# Hi', status: 'indexed', ingested_at: '2026-08-01' }]))
        },
      },
      {
        method: 'DELETE',
        path: '/documents/doc-1',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        },
      },
      {
        method: 'PUT',
        path: '/documents/doc-1',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ id: 'doc-1', filename: 'report.pdf', file_size: 1024, num_pages: 2, num_chunks: 5, extracted_markdown: '# Updated', status: 'indexed', ingested_at: '2026-08-01' }))
        },
      },
      {
        method: 'POST',
        path: '/vector/search',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify([{ chunk_id: 'c-1', text: 'matched', score: 0.95 }]))
        },
      },
      {
        method: 'POST',
        path: '/ingest-path-stream',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          res.write(JSON.stringify({ type: 'progress', percent: 50 }) + '\n')
          res.write(JSON.stringify({ type: 'done', data: { id: 'doc-new', filename: 'doc.txt', file_size: 50, num_pages: 1, num_chunks: 1, extracted_markdown: 'Text', status: 'indexed', ingested_at: 'now' } }) + '\n')
          res.end()
        },
      },
      {
        method: 'POST',
        path: '/agent/logs/analyze',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            scanned_files: ['test.log'],
            total_lines_scanned: 10,
            anomalies: [],
            has_critical: false,
            summary: 'Clean',
          }))
        },
      },
      {
        method: 'POST',
        path: '/export',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ base64_content: Buffer.from('PDF Content').toString('base64') }))
        },
      },
    ])
    server = mock.server
    client = new SidecarHttpClient(mock.baseUrl)
  })

  afterAll(() => {
    server.close()
  })

  it('probes status via /health', async () => {
    const status = await client.getStatus()
    expect(status.status).toBe('online')
    expect(status.version).toBe('2.3.0')
  })

  it('lists documents from /documents', async () => {
    const docs = await client.listDocuments()
    expect(docs).toHaveLength(1)
    expect(docs?.[0].filename).toBe('report.pdf')
  })

  it('deletes document via DELETE /documents/:id', async () => {
    const res = await client.deleteDocument('doc-1')
    expect(res.success).toBe(true)
  })

  it('updates document via PUT /documents/:id', async () => {
    const res = await client.updateDocument('doc-1', '# Updated')
    expect(res.success).toBe(true)
    expect(res.data?.extracted_markdown).toBe('# Updated')
  })

  it('searches vector db via /vector/search', async () => {
    const results = await client.searchVectorDb('test query')
    expect(results).toHaveLength(1)
    expect(results[0].chunk_id).toBe('c-1')
  })

  it('handles streaming ingest via /ingest-path-stream', async () => {
    const events: any[] = []
    const res = await client.ingestFileStream(
      { file_path: 'doc.txt' },
      (ev) => events.push(ev)
    )
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(res.success).toBe(true)
    expect(res.data?.id).toBe('doc-new')
  })

  it('analyzes logs via /agent/logs/analyze', async () => {
    const res = await client.analyzeLogs()
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.summary).toBe('Clean')
    }
  })

  it('exports document via /export', async () => {
    const res = await client.exportDocument('# Title', 'pdf')
    expect(res.success).toBe(true)
    expect(res.data?.base64_content).toBeDefined()
  })

  it('handles unreachable sidecar gracefully without throw', async () => {
    const deadClient = new SidecarHttpClient('http://127.0.0.1:19998')
    const status = await deadClient.getStatus()
    expect(status.status).toBe('offline')

    const docs = await deadClient.listDocuments()
    expect(docs).toBeNull()

    const search = await deadClient.searchVectorDb('hello')
    expect(search).toEqual([])

    const del = await deadClient.deleteDocument('doc-x')
    expect(del.success).toBe(false)
  })
})
