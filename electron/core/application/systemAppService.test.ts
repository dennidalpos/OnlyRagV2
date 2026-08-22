import { describe, it, expect } from 'vitest'
import { SystemAppService } from './systemAppService'

describe('SystemAppService Unit Tests', () => {
  const service = new SystemAppService()

  it('should accurately estimate model sizes for different tiers and families', () => {
    // Small embeddings
    const nomicBytes = service.estimateModelSizeBytes('nomic-embed-text')
    expect(nomicBytes).toBe(Math.round(0.27 * 1024 * 1024 * 1024))

    const mxbaiBytes = service.estimateModelSizeBytes('mxbai-embed-large')
    expect(mxbaiBytes).toBe(Math.round(0.67 * 1024 * 1024 * 1024))

    // Fast lightweight models
    const llama1bBytes = service.estimateModelSizeBytes('llama3.2:1b')
    expect(llama1bBytes).toBe(Math.round(1.3 * 1024 * 1024 * 1024))

    const llama3bBytes = service.estimateModelSizeBytes('llama3.2:3b')
    expect(llama3bBytes).toBe(Math.round(2.0 * 1024 * 1024 * 1024))

    // Workhorse models
    const qwen7bBytes = service.estimateModelSizeBytes('qwen2.5-coder:7b')
    expect(qwen7bBytes).toBe(Math.round(4.7 * 1024 * 1024 * 1024))

    // Large models
    const qwen14bBytes = service.estimateModelSizeBytes('qwen2.5-coder:14b')
    expect(qwen14bBytes).toBe(Math.round(9.0 * 1024 * 1024 * 1024))
  })

  it('should validate download space against free disk space', () => {
    const res = service.validateModelDownloadSpace(['llama3.2:3b', 'nomic-embed-text'])
    expect(res).toBeDefined()
    expect(typeof res.allowed).toBe('boolean')
    expect(res.requiredGB).toBeGreaterThan(0)
    expect(res.freeGB).toBeGreaterThan(0)
  })

  it('should resolve a valid storage path for Ollama or system', () => {
    const storagePath = service.getOllamaStoragePath()
    expect(storagePath).toBeDefined()
    expect(typeof storagePath).toBe('string')
    expect(storagePath.length).toBeGreaterThan(0)
  })

  it('should handle applying environment variables without errors', async () => {
    const res = await service.applyOllamaEnvironmentVariables(
      [
        { name: 'OLLAMA_FLASH_ATTENTION', value: '1' },
        { name: 'OLLAMA_KV_CACHE_TYPE', value: 'q8_0' },
      ],
      false
    )

    expect(res.success).toBe(true)
    expect(res.appliedCount).toBe(2)
    expect(process.env.OLLAMA_FLASH_ATTENTION).toBe('1')
    expect(process.env.OLLAMA_KV_CACHE_TYPE).toBe('q8_0')
  }, 15000)
})
