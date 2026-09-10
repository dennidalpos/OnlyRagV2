import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import https from 'node:https'
import EventEmitter from 'node:events'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import { OllamaRegistryClient } from './ollamaRegistryClient'
import { httpMetrics } from './httpMetrics'

type MockClientRequest = ClientRequest & {
  setTimeout: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

function createMockRequest(): MockClientRequest {
  return Object.assign(new EventEmitter(), {
    setTimeout: vi.fn(),
    destroy: vi.fn(),
    end: vi.fn(),
  }) as MockClientRequest
}

function createMockResponse(statusCode: number): IncomingMessage {
  return Object.assign(new EventEmitter(), { statusCode, headers: {} }) as IncomingMessage
}

function mockRegistryRequest(
  request: MockClientRequest,
  response?: IncomingMessage,
  onResponse?: (response: IncomingMessage) => void
): void {
  vi.spyOn(https, 'request').mockImplementation(((
    _options: string | URL | RequestOptions,
    optionsOrCallback?: RequestOptions | ((response: IncomingMessage) => void),
    callback?: (response: IncomingMessage) => void
  ) => {
    const responseCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
    if (response && responseCallback) {
      process.nextTick(() => {
        responseCallback(response)
        onResponse?.(response)
      })
    }
    return request
  }) as unknown as typeof https.request)
}

describe('OllamaRegistryClient Unit Tests', () => {
  let client: OllamaRegistryClient

  beforeEach(() => {
    client = new OllamaRegistryClient('https://mock-registry.ollama.ai')
    httpMetrics.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return error on empty model target', async () => {
    const res = await client.fetchRemoteManifestDigest('')
    expect(res.success).toBe(false)
    expect(res.error).toBe('Empty model name')
  })

  it('should fetch manifest and return calculated sha256 digest on HTTP 200', async () => {
    const mockPayload = Buffer.from(JSON.stringify({ schemaVersion: 2, layers: [] }), 'utf-8')
    const crypto = await import('node:crypto')
    const expectedDigest = crypto.createHash('sha256').update(mockPayload).digest('hex')

    const mockReq = createMockRequest()
    const mockRes = createMockResponse(200)
    mockRegistryRequest(mockReq, mockRes, () => {
      mockRes.emit('data', mockPayload)
      mockRes.emit('end')
    })

    const res = await client.fetchRemoteManifestDigest('qwen2.5-coder:7b')
    expect(res.success).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.digest).toBe(expectedDigest)
    expect(httpMetrics.snapshot()).toMatchObject([
      { endpoint: '/v2/manifest', status: 200, errorType: 'none', count: 1 },
    ])
  })

  it('should return success false on HTTP 404', async () => {
    const mockReq = createMockRequest()
    const mockRes = createMockResponse(404)
    mockRegistryRequest(mockReq, mockRes, () => {
      mockRes.emit('data', Buffer.from('{"error":"not found"}'))
      mockRes.emit('end')
    })

    const res = await client.fetchRemoteManifestDigest('custom-local-model:latest')
    expect(res.success).toBe(false)
    expect(res.statusCode).toBe(404)
    expect(res.error).toContain('HTTP 404')
    expect(httpMetrics.snapshot()).toMatchObject([
      { endpoint: '/v2/manifest', status: 404, errorType: 'http', count: 1 },
    ])
  })

  it('should handle request network errors gracefully', async () => {
    const mockReq = createMockRequest()
    vi.spyOn(https, 'request').mockImplementation((() => {
      process.nextTick(() => {
        mockReq.emit('error', new Error('ENOTFOUND'))
      })
      return mockReq
    }) as typeof https.request)

    const res = await client.fetchRemoteManifestDigest('qwen2.5-coder:7b')
    expect(res.success).toBe(false)
    expect(res.error).toBe('ENOTFOUND')
  })
})
