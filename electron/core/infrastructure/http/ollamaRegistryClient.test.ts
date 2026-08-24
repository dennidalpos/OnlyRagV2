import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import https from 'node:https'
import EventEmitter from 'node:events'
import { OllamaRegistryClient } from './ollamaRegistryClient'

describe('OllamaRegistryClient Unit Tests', () => {
  let client: OllamaRegistryClient

  beforeEach(() => {
    client = new OllamaRegistryClient('https://mock-registry.ollama.ai')
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

    const mockReq = new EventEmitter() as any
    mockReq.setTimeout = vi.fn()
    mockReq.destroy = vi.fn()
    mockReq.end = vi.fn()

    vi.spyOn(https, 'request').mockImplementation((_options: any, callback: any) => {
      const mockRes = new EventEmitter() as any
      mockRes.statusCode = 200
      process.nextTick(() => {
        if (callback) callback(mockRes)
        mockRes.emit('data', mockPayload)
        mockRes.emit('end')
      })
      return mockReq
    })

    const res = await client.fetchRemoteManifestDigest('qwen2.5-coder:7b')
    expect(res.success).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.digest).toBe(expectedDigest)
  })

  it('should return success false on HTTP 404', async () => {
    const mockReq = new EventEmitter() as any
    mockReq.setTimeout = vi.fn()
    mockReq.destroy = vi.fn()
    mockReq.end = vi.fn()

    vi.spyOn(https, 'request').mockImplementation((_options: any, callback: any) => {
      const mockRes = new EventEmitter() as any
      mockRes.statusCode = 404
      process.nextTick(() => {
        if (callback) callback(mockRes)
        mockRes.emit('data', Buffer.from('{"error":"not found"}'))
        mockRes.emit('end')
      })
      return mockReq
    })

    const res = await client.fetchRemoteManifestDigest('custom-local-model:latest')
    expect(res.success).toBe(false)
    expect(res.statusCode).toBe(404)
    expect(res.error).toContain('HTTP 404')
  })

  it('should handle request network errors gracefully', async () => {
    const mockReq = new EventEmitter() as any
    mockReq.setTimeout = vi.fn()
    mockReq.destroy = vi.fn()
    mockReq.end = vi.fn()

    vi.spyOn(https, 'request').mockImplementation(() => {
      process.nextTick(() => {
        mockReq.emit('error', new Error('ENOTFOUND'))
      })
      return mockReq
    })

    const res = await client.fetchRemoteManifestDigest('qwen2.5-coder:7b')
    expect(res.success).toBe(false)
    expect(res.error).toBe('ENOTFOUND')
  })
})
