import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SidecarHttpClient } from './sidecarHttpClient'

const documentRecord = {
  id: 'doc-1',
  filename: 'fixture.txt',
  file_size: 4,
  num_pages: 1,
  num_chunks: 1,
  extracted_markdown: 'Text',
  status: 'indexed',
  ingested_at: 't1',
  file_type: 'text',
}

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
  it.each(['{bad-json}\n', '{"type":"done","data":{"id":"incomplete"}}\n', '{"type":"progress","percent":101}\n', '{"type":"unknown"}\n'])(
    'refuses malformed stream data before a later valid done: %s',
    async (prefix) => {
      const mock = await createMockServer([
        {
          method: 'POST',
          path: '/',
          handler: (_req, res) => {
            res.end(prefix + JSON.stringify({ type: 'done', data: documentRecord }) + '\n')
          },
        },
      ])
      try {
        const result = await new SidecarHttpClient(mock.baseUrl).ingestFileStream({ file_path: 'fixture', task_id: 'validation' }, () => {})
        expect(result.success).toBe(false)
        expect(result.data).toBeUndefined()
      } finally {
        mock.server.closeAllConnections()
        await new Promise<void>((resolve) => mock.server.close(() => resolve()))
      }
    },
  )

  it.each(['done', 'cancelled', 'progress'])('rejects %s following a done terminal', async (type) => {
    const mock = await createMockServer([
      {
        method: 'POST',
        path: '/',
        handler: (_req, res) => {
          res.end([JSON.stringify({ type: 'done', data: documentRecord }), JSON.stringify({ type, data: documentRecord })].join('\n') + '\n')
        },
      },
    ])
    try {
      const result = await new SidecarHttpClient(mock.baseUrl).ingestFileStream({ file_path: 'fixture', task_id: 'terminal' }, () => {})
      expect(result.success).toBe(false)
    } finally {
      mock.server.closeAllConnections()
      await new Promise<void>((resolve) => mock.server.close(() => resolve()))
    }
  })

  it('bounds total elapsed time even when a response keeps sending bytes', async () => {
    const mock = await createMockServer([
      {
        method: 'POST',
        path: '/',
        handler: (_req, res) => {
          res.writeHead(200)
          res.write(' ')
          const interval = setInterval(() => res.write(' '), 5)
          const end = setTimeout(() => res.end('{}'), 300)
          res.on('close', () => {
            clearInterval(interval)
            clearTimeout(end)
          })
        },
      },
    ])
    try {
      const result = await new SidecarHttpClient(mock.baseUrl).postJsonEnvelope('/', {}, 50)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('timed out after 50ms') })
    } finally {
      mock.server.closeAllConnections()
      await new Promise<void>((resolve) => mock.server.close(() => resolve()))
    }
  })

  it('refuses malformed document reads and a valid record for the wrong identity', async () => {
    const mock = await createMockServer([
      {
        method: 'GET',
        path: '/',
        handler: (req, res) => {
          res.end(req.url === '/documents' ? '[{"id":"incomplete"}]' : JSON.stringify({ ...documentRecord, file_path: 'fixture.txt' }))
        },
      },
    ])
    try {
      const client = new SidecarHttpClient(mock.baseUrl)
      expect(await client.listDocuments()).toBeNull()
      expect(await client.getDocument('another-document')).toBeNull()
    } finally {
      mock.server.closeAllConnections()
      await new Promise<void>((resolve) => mock.server.close(() => resolve()))
    }
  })
  it.each(['cancelled', 'error'] as const)('waits for ingestion cleanup acknowledgement: %s', async (terminal) => {
    let stream: http.ServerResponse | undefined
    let acknowledgeCancel!: () => void
    const cancelReceived = new Promise<void>((resolve) => {
      acknowledgeCancel = resolve
    })
    const mock = await createMockServer([
      {
        method: 'POST',
        path: '/ingest-path-stream',
        handler: (_req, res) => {
          stream = res
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          res.write('{"type":"progress"}\n')
        },
      },
      {
        method: 'POST',
        path: '/tasks/cancel',
        handler: (_req, res) => {
          res.end('{"status":"success","message":"Cancellation requested"}')
          acknowledgeCancel()
        },
      },
    ])
    try {
      let cancel: (() => void) | undefined
      let settled = false
      const pending = new SidecarHttpClient(mock.baseUrl)
        .ingestFileStream(
          { file_path: 'fixture.txt', task_id: 'cancel-cleanup' },
          (event) => {
            if (event.type === 'progress') cancel?.()
          },
          (fn) => {
            cancel = fn
          },
        )
        .then((result) => {
          settled = true
          return result
        })
      await cancelReceived
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(settled).toBe(false)
      stream!.end(JSON.stringify({ type: terminal, error: 'Cleanup failed; preserve archive' }) + '\n')
      const result = await pending
      expect(result.success).toBe(false)
      if (terminal === 'cancelled') expect(result).toMatchObject({ cancelled: true })
      else expect(result.error).toContain('Cleanup failed')
    } finally {
      mock.server.closeAllConnections()
      await new Promise<void>((resolve) => mock.server.close(() => resolve()))
    }
  })

  it.each(['json', 'ndjson', 'ndjson-no-newline'] as const)('preserves UTF-8 at every byte boundary in %s responses', async (kind) => {
    const text = 'città 漢 😀'
    const wire = Buffer.from(
      kind === 'json'
        ? JSON.stringify({ text })
        : `${JSON.stringify({ type: 'progress', step: text })}\n${JSON.stringify({ type: 'done', data: { ...documentRecord, extracted_markdown: text } })}${kind === 'ndjson' ? '\n' : ''}`,
    )
    let split = 0
    const mock = await createMockServer([
      {
        method: 'POST',
        path: '/',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': kind === 'json' ? 'application/json' : 'application/x-ndjson' })
          res.write(wire.subarray(0, split))
          // Separate socket reads, including splits within a multibyte character.
          setTimeout(() => res.end(wire.subarray(split)), 5)
        },
      },
    ])
    try {
      const client = new SidecarHttpClient(mock.baseUrl)
      for (split = 1; split < wire.length; split++) {
        const steps: unknown[] = []
        const result =
          kind === 'json'
            ? await client.postJsonEnvelope('/probe', {}, 1000)
            : await client.ingestFileStream({ file_path: 'fixture.txt', task_id: 'utf8' }, (event) => {
                if (event.type === 'progress') steps.push(event.step)
              })
        expect(result).toEqual({ success: true, data: kind === 'json' ? { text } : { ...documentRecord, extracted_markdown: text } })
        if (kind !== 'json') expect(steps).toEqual([text])
      }
    } finally {
      mock.server.closeAllConnections()
      await new Promise<void>((resolve) => mock.server.close(() => resolve()))
    }
  })

  it.each(['valid', 'wrong-document', 'malformed-span'] as const)('validates source-location identity and exact spans (%s)', async (scenario) => {
    const revision = 'a'.repeat(64)
    const payload = {
      docId: 'doc',
      chunkId: 'doc_chunk_0',
      sourceRevision: revision,
      extractionRevision: revision,
      indexRevision: revision,
      spanStart: 2,
      spanEnd: 4,
    }
    let requestedUrl = ''
    let authenticated = false
    const mock = await createMockServer([
      {
        method: 'GET',
        path: '/documents/doc/source-location',
        handler: (req, res) => {
          requestedUrl = req.url || ''
          authenticated = req.headers['x-onlyrag-token'] === 'test-token'
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              doc_id: scenario === 'wrong-document' ? 'other' : 'doc',
              chunk_id: 'doc_chunk_0',
              source_revision: revision,
              extraction_revision: revision,
              index_revision: revision,
              span_start: 2,
              span_end: scenario === 'malformed-span' ? 5 : 4,
              exact_quote: '😀x',
            }),
          )
        },
      },
    ])
    try {
      const client = new SidecarHttpClient(mock.baseUrl)
      client.setAuthToken('test-token')
      if (scenario === 'valid') expect((await client.getSourceLocation(payload)).exact_quote).toBe('😀x')
      else await expect(client.getSourceLocation(payload)).rejects.toThrow()
      expect(authenticated).toBe(true)
      expect(new URL(requestedUrl, mock.baseUrl).searchParams.get('chunk_id')).toBe(payload.chunkId)
    } finally {
      await new Promise<void>((resolve, reject) => mock.server.close((error) => (error ? reject(error) : resolve())))
    }
  })
  it.each(['entities_changed', 'context_missing', 'context_budget_exceeded', 'verified'] as const)(
    'keeps a normalization refusal failed even after a done event (%s)',
    async (reason) => {
      const invalid = reason === 'verified'
      const original = '# Original\n\nReference AB123 must remain unchanged.'
      const mock = await createMockServer([
        {
          method: 'POST',
          path: '/ingest-path-stream',
          handler: (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
            res.write(
              `${JSON.stringify({
                type: 'error',
                error: 'Review required',
                normalization_review: { original_markdown: original, issues: [{ page: 1, reason }] },
              })}\n`,
            )
            res.end(`${JSON.stringify({ type: 'done', data: { id: 'false-success' } })}\n`)
          },
        },
      ])
      try {
        const client = new SidecarHttpClient(mock.baseUrl)
        const events: { type?: string }[] = []
        const result = await client.ingestFileStream({ file_path: 'doc.pdf', task_id: 'review-test' }, (event) => events.push(event))
        expect(result.success).toBe(false)
        expect(result.data).toBeUndefined()
        expect(events.map((event) => event.type)).toEqual(['error'])
        if (invalid) {
          expect(result.error).toContain('Invalid normalization review')
          expect(result.normalizationReview).toBeUndefined()
        } else {
          expect(result.normalizationReview).toEqual({ originalMarkdown: original, issues: [{ page: 1, reason }] })
        }
      } finally {
        await new Promise<void>((resolve, reject) => mock.server.close((error) => (error ? reject(error) : resolve())))
      }
    },
  )

  it('reports a 503 health response offline and preserves document failure as unavailable', async () => {
    const broken = await createMockServer([
      {
        method: 'GET',
        path: '/health',
        handler: (_req, res) => {
          res.writeHead(503)
          res.end('{"detail":"Database unavailable"}')
        },
      },
      {
        method: 'GET',
        path: '/documents',
        handler: (_req, res) => {
          res.writeHead(500)
          res.end('{"detail":"Internal Server Error"}')
        },
      },
    ])
    try {
      const client = new SidecarHttpClient(broken.baseUrl)
      expect(await client.getStatus()).toEqual({ status: 'offline', error: 'HTTP 503' })
      expect(await client.listDocuments()).toBeNull()
    } finally {
      await new Promise<void>((resolve, reject) => broken.server.close((error) => (error ? reject(error) : resolve())))
    }
  })
  let server: http.Server
  let client: SidecarHttpClient

  beforeAll(async () => {
    const mock = await createMockServer([
      {
        method: 'GET',
        path: '/health',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              status: 'online',
              engine: 'FastAPI + LanceDB',
              version: '2.3.0',
              vector_db: 'LanceDB Embedded',
              gpu: {},
              ocr: {},
              documents_count: 2,
              chunks_count: 5,
              python_version: '3.13',
            }),
          )
        },
      },
      {
        method: 'GET',
        path: '/documents',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify([
              {
                id: 'doc-1',
                filename: 'report.pdf',
                file_path: 'D:/fixture/report.pdf',
                file_type: 'pdf',
                file_size: 1024,
                num_pages: 2,
                num_chunks: 5,
                extracted_markdown: '# Hi',
                status: 'indexed',
                ingested_at: '2026-08-01',
              },
            ]),
          )
        },
      },
      {
        method: 'DELETE',
        path: '/documents/doc-1',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'success', message: 'Deleted' }))
        },
      },
      {
        method: 'PUT',
        path: '/documents/doc-1',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'doc-1',
              filename: 'report.pdf',
              file_type: 'pdf',
              file_size: 1024,
              num_pages: 2,
              num_chunks: 5,
              extracted_markdown: '# Updated',
              status: 'indexed',
              ingested_at: '2026-08-01',
            }),
          )
        },
      },
      {
        method: 'POST',
        path: '/vector/search',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify([{ chunk_id: 'c-1', doc_name: 'report.pdf', text: 'matched', score: 0.95 }]))
        },
      },
      {
        method: 'POST',
        path: '/ingest-path-stream',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          res.write(JSON.stringify({ type: 'progress', percent: 50 }) + '\n')
          res.write(
            JSON.stringify({
              type: 'done',
              data: {
                id: 'doc-new',
                filename: 'doc.txt',
                file_type: 'text',
                file_size: 50,
                num_pages: 1,
                num_chunks: 1,
                extracted_markdown: 'Text',
                status: 'indexed',
                ingested_at: 'now',
              },
            }) + '\n',
          )
          res.end()
        },
      },
      {
        method: 'POST',
        path: '/export',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              status: 'success',
              format: 'pdf',
              file_name: 'export.pdf',
              file_path: 'D:/fixture/export.pdf',
              message: 'Exported',
              base64_content: Buffer.from('PDF Content').toString('base64'),
            }),
          )
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
    expect(status.documentsCount).toBe(2)
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
    const res = await client.updateDocument('doc-1', '# Updated', 't1')
    expect(res.success).toBe(true)
    expect(res.data?.extracted_markdown).toBe('# Updated')
  })

  it('searches vector db via /vector/search', async () => {
    const results = await client.searchVectorDb('test query')
    expect(results).toHaveLength(1)
    expect(results[0].chunk_id).toBe('c-1')
  })

  it('handles streaming ingest via /ingest-path-stream', async () => {
    const events: unknown[] = []
    const res = await client.ingestFileStream({ file_path: 'doc.txt', task_id: 'ingest-test-1' }, (ev) => events.push(ev))
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(res.success).toBe(true)
    expect(res.data?.id).toBe('doc-new')
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

    // Search failures reject so the UI can tell "no matches" from "search unavailable".
    await expect(deadClient.searchVectorDb('hello')).rejects.toThrow(/Vector search failed/)

    const del = await deadClient.deleteDocument('doc-x')
    expect(del.success).toBe(false)
  })
})

describe('SidecarHttpClient health failures', () => {
  const servers: http.Server[] = []

  afterAll(() => servers.forEach((server) => server.close()))

  it('fails closed for malformed payloads and non-success HTTP responses', async () => {
    const malformed = await createMockServer([
      {
        method: 'GET',
        path: '/health',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"status":"online"}')
        },
      },
    ])
    const unavailable = await createMockServer([
      {
        method: 'GET',
        path: '/health',
        handler: (_req, res) => {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end('{"status":"online"}')
        },
      },
    ])
    servers.push(malformed.server, unavailable.server)

    await expect(new SidecarHttpClient(malformed.baseUrl).getStatus()).resolves.toMatchObject({ status: 'offline' })
    await expect(new SidecarHttpClient(unavailable.baseUrl).getStatus()).resolves.toEqual({ status: 'offline', error: 'HTTP 503' })
  })

  it('fails closed when the health probe times out', async () => {
    const stalled = await createMockServer([
      {
        method: 'GET',
        path: '/health',
        handler: () => {},
      },
    ])
    servers.push(stalled.server)

    await expect(new SidecarHttpClient(stalled.baseUrl).getStatus(25)).resolves.toEqual({
      status: 'offline',
      error: 'Health probe timed out after 25ms',
    })
  })

  it('returns an actionable document deletion error from the sidecar', async () => {
    const unavailable = await createMockServer([
      {
        method: 'DELETE',
        path: '/documents/doc-locked',
        handler: (_req, res) => {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ detail: 'Documento in uso. Riprova al termine della traduzione.' }))
        },
      },
    ])
    servers.push(unavailable.server)

    await expect(new SidecarHttpClient(unavailable.baseUrl).deleteDocument('doc-locked')).resolves.toEqual({
      success: false,
      error: 'Documento in uso. Riprova al termine della traduzione.',
    })
  })

  it('surfaces an error event from an NDJSON stream instead of a generic termination', async () => {
    const failing = await createMockServer([
      {
        method: 'POST',
        path: '/documents/doc-1/translate-inplace-stream',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          res.end(JSON.stringify({ type: 'error', error: 'No translatable text blocks found in document' }) + '\n')
        },
      },
    ])
    servers.push(failing.server)

    const res = await new SidecarHttpClient(failing.baseUrl).translateDocumentInplaceStream(
      'doc-1',
      { source_lang: 'en', target_lang: 'it', task_id: 't-1' },
      () => {},
    )
    expect(res).toEqual({ success: false, error: 'No translatable text blocks found in document' })
  })

  it('waits for the translation terminal after relaying cancellation', async () => {
    const cancelled: string[] = []
    let stream: http.ServerResponse | undefined
    const slow = await createMockServer([
      {
        method: 'POST',
        path: '/documents/doc-1/translate-inplace-stream',
        handler: (_req, res) => {
          stream = res
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          res.write(`${JSON.stringify({ type: 'start', total_pages: 3 })}\n`)
        },
      },
      {
        method: 'POST',
        path: '/tasks/cancel',
        handler: (req, res) => {
          cancelled.push(new URL(req.url || '', 'http://x').searchParams.get('task_id') || '')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"status":"success","message":"Cancellation requested"}')
        },
      },
    ])
    servers.push(slow.server)

    let cancel: (() => void) | undefined
    const pending = new SidecarHttpClient(slow.baseUrl).translateDocumentInplaceStream(
      'doc-1',
      { source_lang: 'en', target_lang: 'it', task_id: 'translate-42' },
      () => cancel?.(),
      (cancelFn) => {
        cancel = cancelFn
      },
    )

    let settled = false
    void pending.then(() => {
      settled = true
    })
    await expect.poll(() => cancelled).toEqual(['translate-42'])
    expect(settled).toBe(false)
    stream!.end('{"type":"cancelled"}\n')
    expect(await pending).toMatchObject({ success: false, cancelled: true })
  })

  it('sends the launch token on every request once set', async () => {
    const seen: Array<string | undefined> = []
    const recorder = await createMockServer([
      {
        method: 'GET',
        path: '/documents',
        handler: (req, res) => {
          seen.push(req.headers['x-onlyrag-token'] as string | undefined)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('[]')
        },
      },
    ])
    servers.push(recorder.server)

    const tokenClient = new SidecarHttpClient(recorder.baseUrl)
    await tokenClient.listDocuments()
    tokenClient.setAuthToken('launch-token')
    await tokenClient.listDocuments()
    expect(seen).toEqual([undefined, 'launch-token'])
  })

  it('sends the configured embedding model when re-indexing a document', async () => {
    let received: unknown = null
    const recorder = await createMockServer([
      {
        method: 'PUT',
        path: '/documents/doc-1',
        handler: (req, res) => {
          let raw = ''
          req.on('data', (chunk) => {
            raw += chunk
          })
          req.on('end', () => {
            received = JSON.parse(raw)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ id: 'doc-1' }))
          })
        },
      },
    ])
    servers.push(recorder.server)

    await new SidecarHttpClient(recorder.baseUrl).updateDocument('doc-1', '# Edited', 't1', 'mxbai-embed-large')
    expect(received).toEqual({ markdown_content: '# Edited', expected_revision: 't1', embedding_model: 'mxbai-embed-large' })
  })
})
