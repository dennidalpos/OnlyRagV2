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

  describe('openExternal and openPath', () => {
    it('should reject invalid or non-http/mailto schemes', async () => {
      const openedUrls: string[] = []
      const customService = new SystemAppService(
        { loadSettings: async () => ({ capabilityPolicyMode: 'network-approved' } as any) },
        { openExternal: async (u) => { openedUrls.push(u) }, openPath: async () => '' }
      )

      expect(await customService.openExternal('')).toBe(false)
      expect(await customService.openExternal('ftp://example.com')).toBe(false)
      expect(await customService.openExternal('file:///etc/passwd')).toBe(false)
      expect(openedUrls).toHaveLength(0)
    })

    it('should block external URLs when policy is offline-strict', async () => {
      const openedUrls: string[] = []
      const customService = new SystemAppService(
        { loadSettings: async () => ({ capabilityPolicyMode: 'offline-strict' } as any) },
        { openExternal: async (u) => { openedUrls.push(u) }, openPath: async () => '' }
      )

      const result = await customService.openExternal('https://github.com')
      expect(result).toBe(false)
      expect(openedUrls).toHaveLength(0)
    })

    it('should block non-loopback URLs when policy is local-only', async () => {
      const openedUrls: string[] = []
      const customService = new SystemAppService(
        { loadSettings: async () => ({ capabilityPolicyMode: 'local-only' } as any) },
        { openExternal: async (u) => { openedUrls.push(u) }, openPath: async () => '' }
      )

      expect(await customService.openExternal('https://github.com')).toBe(false)
      expect(openedUrls).toHaveLength(0)

      expect(await customService.openExternal('http://127.0.0.1:8000/health')).toBe(true)
      expect(openedUrls).toContain('http://127.0.0.1:8000/health')
    })

    it('should allow external URLs when policy is permissive or default', async () => {
      const openedUrls: string[] = []
      const customService = new SystemAppService(
        { loadSettings: async () => ({ capabilityPolicyMode: 'network-approved' } as any) },
        { openExternal: async (u) => { openedUrls.push(u) }, openPath: async () => '' }
      )

      const result = await customService.openExternal('https://github.com/dennidalpos/OnlyRagV2')
      expect(result).toBe(true)
      expect(openedUrls).toContain('https://github.com/dennidalpos/OnlyRagV2')
    })

    it('should validate targetPath and invoke shell.openPath', async () => {
      const openedPaths: string[] = []
      const customService = new SystemAppService(
        { loadSettings: async () => null },
        { openExternal: async () => {}, openPath: async (p) => { openedPaths.push(p); return '' } }
      )

      expect(await customService.openPath('')).toBe(false)
      expect(await customService.openPath('   ')).toBe(false)
      expect(await customService.openPath('/my/workspace/folder')).toBe(true)
      expect(openedPaths).toEqual(['/my/workspace/folder'])
    })
  })
})
