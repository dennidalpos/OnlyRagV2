import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { OllamaHttpClient } from './ollamaHttpClient'

function createMockOllamaServer(routes: Array<{ method: string; path: string; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void }>) {
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    const server = http.createServer((req, res) => {
      const route = routes.find((r) => r.method === req.method && (req.url || '').startsWith(r.path))
      if (route) {
        route.handler(req, res)
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` })
    })
  })
}

describe('OllamaHttpClient — /api/tags Consolidation Unit Tests', () => {
  let server: http.Server
  let client: OllamaHttpClient

  beforeAll(async () => {
    const mock = await createMockOllamaServer([
      {
        method: 'GET',
        path: '/api/tags',
        handler: (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            models: [
              {
                name: 'qwen2.5-coder:7b',
                digest: 'sha256:abcd1234',
                modified_at: '2026-08-20T12:00:00Z',
                size: 4700000000,
                details: {
                  parameter_size: '7.6B',
                  quantization_level: 'Q4_K_M',
                  family: 'qwen2',
                  context_length: 32768,
                },
                capabilities: ['completion', 'tools'],
              },
              {
                name: 'llama3.2:3b',
                digest: 'sha256:efgh5678',
                modified_at: '2026-08-21T14:00:00Z',
                size: 2000000000,
                details: {
                  parameter_size: '3.2B',
                  quantization_level: 'Q4_K_M',
                  family: 'llama',
                },
                capabilities: ['completion'],
              },
            ],
          }))
        },
      },
      {
        method: 'POST',
        path: '/api/show',
        handler: (req, res) => {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', () => {
            const parsed = JSON.parse(body || '{}')
            if (parsed.model === 'llama3.2:3b') {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ details: { context_length: 8192 } }))
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({}))
            }
          })
        },
      },
    ])
    server = mock.server
    client = new OllamaHttpClient()
    client.setBaseHost(mock.baseUrl)
  })

  afterAll(() => {
    server.close()
  })

  it('getModelTagsWithDigests extracts tag names, digests, and modifiedAt', async () => {
    const list = await client.getModelTagsWithDigests()
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({
      name: 'qwen2.5-coder:7b',
      digest: 'sha256:abcd1234',
      modifiedAt: '2026-08-20T12:00:00Z',
    })
    expect(list[1].name).toBe('llama3.2:3b')
  })

  it('getModelCapabilities extracts model capabilities accurately', async () => {
    const capabilities = await client.getModelCapabilities()
    expect(capabilities['qwen2.5-coder:7b']).toEqual(['completion', 'tools'])
    expect(capabilities['llama3.2:3b']).toEqual(['completion'])
  })

  it('getModelMetrics extracts and enriches model metrics', async () => {
    const metrics = await client.getModelMetrics()
    expect(metrics['qwen2.5-coder:7b']).toBeDefined()
    expect(metrics['qwen2.5-coder:7b'].contextLength).toBe(32768)
    expect(metrics['qwen2.5-coder:7b'].parameterSize).toBe('7.6B')
    expect(metrics['qwen2.5-coder:7b'].family).toBe('qwen2')

    // llama3.2 context length should be enriched from /api/show
    expect(metrics['llama3.2:3b'].contextLength).toBe(8192)
    expect(metrics['llama3.2:3b'].family).toBe('llama')
  })

  it('handles offline host gracefully without throwing or rejecting', async () => {
    const offlineClient = new OllamaHttpClient()
    offlineClient.setBaseHost('http://127.0.0.1:19997')

    const tags = await offlineClient.getModelTagsWithDigests()
    expect(tags).toEqual([])

    const caps = await offlineClient.getModelCapabilities()
    expect(caps).toEqual({})

    const metrics = await offlineClient.getModelMetrics()
    expect(metrics).toEqual({})
  })
})
