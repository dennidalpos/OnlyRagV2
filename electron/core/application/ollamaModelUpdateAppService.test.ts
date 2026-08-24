import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OllamaModelUpdateAppService } from './ollamaModelUpdateAppService'
import { ollamaHttpClient } from '../infrastructure/http/ollamaHttpClient'

describe('OllamaModelUpdateAppService Unit Tests', () => {
  let appService: OllamaModelUpdateAppService
  let mockRegistryClient: any

  beforeEach(() => {
    mockRegistryClient = {
      fetchRemoteManifestDigest: vi.fn(),
    }
    appService = new OllamaModelUpdateAppService(mockRegistryClient)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Update Concurrency Mutex', () => {
    it('should allow acquiring lock when free', () => {
      expect(appService.getActiveUpdatingModel()).toBeNull()
      const acquired = appService.acquireUpdateLock('qwen2.5-coder:7b')
      expect(acquired).toBe(true)
      expect(appService.getActiveUpdatingModel()).toBe('qwen2.5-coder:7b')
    })

    it('should reject acquiring lock when another model is active', () => {
      appService.acquireUpdateLock('qwen2.5-coder:7b')
      const secondAcquired = appService.acquireUpdateLock('llama3.2:latest')
      expect(secondAcquired).toBe(false)
      expect(appService.getActiveUpdatingModel()).toBe('qwen2.5-coder:7b')
    })

    it('should allow acquiring lock again for same model', () => {
      appService.acquireUpdateLock('qwen2.5-coder:7b')
      const sameAcquired = appService.acquireUpdateLock('qwen2.5-coder:7b')
      expect(sameAcquired).toBe(true)
    })

    it('should release lock cleanly', () => {
      appService.acquireUpdateLock('qwen2.5-coder:7b')
      appService.releaseUpdateLock('qwen2.5-coder:7b')
      expect(appService.getActiveUpdatingModel()).toBeNull()

      const nowAcquired = appService.acquireUpdateLock('llama3.2:latest')
      expect(nowAcquired).toBe(true)
      expect(appService.getActiveUpdatingModel()).toBe('llama3.2:latest')
    })
  })

  describe('checkModelUpdates', () => {
    it('should return empty map when no local models are installed', async () => {
      vi.spyOn(ollamaHttpClient, 'getModelTagsWithDigests').mockResolvedValue([])
      const res = await appService.checkModelUpdates()
      expect(res).toEqual({})
    })

    it('should detect update available when remote digest differs from local digest', async () => {
      vi.spyOn(ollamaHttpClient, 'getModelTagsWithDigests').mockResolvedValue([
        {
          name: 'qwen2.5-coder:7b',
          digest: 'local-old-digest-aaa',
        },
        {
          name: 'embeddinggemma:latest',
          digest: 'matching-digest-bbb',
        },
      ])

      mockRegistryClient.fetchRemoteManifestDigest.mockImplementation(async (modelName: string) => {
        if (modelName === 'qwen2.5-coder:7b') {
          return { success: true, digest: 'remote-new-digest-xxx' }
        }
        return { success: true, digest: 'matching-digest-bbb' }
      })

      const res = await appService.checkModelUpdates()

      expect(res['qwen2.5-coder:7b']).toEqual({
        updateAvailable: true,
        localDigest: 'local-old-digest-aaa',
        remoteDigest: 'remote-new-digest-xxx',
      })

      expect(res['embeddinggemma:latest']).toEqual({
        updateAvailable: false,
        localDigest: 'matching-digest-bbb',
        remoteDigest: 'matching-digest-bbb',
      })
    })

    it('should handle custom models not found in registry (HTTP 404) gracefully', async () => {
      vi.spyOn(ollamaHttpClient, 'getModelTagsWithDigests').mockResolvedValue([
        {
          name: 'my-custom-model:latest',
          digest: 'custom-local-digest',
        },
      ])

      mockRegistryClient.fetchRemoteManifestDigest.mockResolvedValue({
        success: false,
        statusCode: 404,
        error: 'Model not found in registry (HTTP 404)',
      })

      const res = await appService.checkModelUpdates()

      expect(res['my-custom-model:latest']).toEqual({
        updateAvailable: false,
        localDigest: 'custom-local-digest',
        error: 'Model not found in registry (HTTP 404)',
      })
    })
  })
})
