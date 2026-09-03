import { describe, it, expect } from 'vitest'
import { resolveToolCallingRoute, supportsNativeToolCalling, supportsNativeToolCallingByFamily } from '../../../../shared/domain/agent/ollamaToolCallingCapability'

describe('ollamaToolCallingCapability', () => {
  describe('resolveToolCallingRoute (session handshake)', () => {
    it('probes when Ollama omits capabilities, then uses the observed protocol', () => {
      expect(resolveToolCallingRoute('custom:latest', { 'custom:latest': [] })).toEqual({ capable: true, probe: true })
      expect(resolveToolCallingRoute('custom:latest', { 'custom:latest': [] }, 'text')).toEqual({ capable: false, probe: false })
      expect(resolveToolCallingRoute('custom:latest', { 'custom:latest': [] }, 'native')).toEqual({ capable: true, probe: false })
    })

    it('keeps non-empty Ollama capability metadata authoritative over observations', () => {
      expect(resolveToolCallingRoute('known:latest', { 'known:latest': ['completion'] }, 'native')).toEqual({ capable: false, probe: false })
      expect(resolveToolCallingRoute('known:latest', { 'known:latest': ['completion', 'tools'] }, 'text')).toEqual({ capable: true, probe: false })
    })
  })

  describe('supportsNativeToolCallingByFamily (allow-list fallback)', () => {
    it('should recognize known tool-calling-capable families', () => {
      expect(supportsNativeToolCallingByFamily('llama3.1:8b')).toBe(true)
      expect(supportsNativeToolCallingByFamily('llama3.2:3b')).toBe(true)
      expect(supportsNativeToolCallingByFamily('qwen2.5:7b')).toBe(true)
      expect(supportsNativeToolCallingByFamily('qwen2.5-coder:7b')).toBe(true)
      expect(supportsNativeToolCallingByFamily('qwen3:4b')).toBe(true)
      expect(supportsNativeToolCallingByFamily('mistral-nemo:12b')).toBe(true)
      expect(supportsNativeToolCallingByFamily('command-r:35b')).toBe(true)
    })

    it('should reject models with no known native tool-calling support', () => {
      expect(supportsNativeToolCallingByFamily('deepseek-r1:8b')).toBe(false)
      expect(supportsNativeToolCallingByFamily('llama3:8b')).toBe(false)
      expect(supportsNativeToolCallingByFamily('llava:7b')).toBe(false)
      expect(supportsNativeToolCallingByFamily('moondream:latest')).toBe(false)
      expect(supportsNativeToolCallingByFamily('bge-m3:latest')).toBe(false)
    })

    it('should handle missing/empty model names safely', () => {
      expect(supportsNativeToolCallingByFamily('')).toBe(false)
      expect(supportsNativeToolCallingByFamily(undefined as any)).toBe(false)
    })
  })

  describe('supportsNativeToolCalling (capabilities map, with allow-list fallback)', () => {
    it('should trust the capabilities map when present, even overriding the allow-list', () => {
      const caps = { 'llama3.1:8b': ['completion'] } // Ollama reports NO tools capability for this tag
      expect(supportsNativeToolCalling('llama3.1:8b', caps)).toBe(false)
    })

    it('should trust a positive "tools" capability even for a model not in the allow-list', () => {
      const caps = { 'some-custom-finetune:latest': ['completion', 'tools'] }
      expect(supportsNativeToolCalling('some-custom-finetune:latest', caps)).toBe(true)
    })

    it('should fall back to the family allow-list when the model is absent from the capabilities map', () => {
      const caps = { 'other-model:latest': ['completion'] }
      expect(supportsNativeToolCalling('qwen2.5:7b', caps)).toBe(true)
      expect(supportsNativeToolCalling('deepseek-r1:8b', caps)).toBe(false)
    })

    it('should fall back to the family allow-list when no capabilities map is provided at all', () => {
      expect(supportsNativeToolCalling('llama3.2:3b')).toBe(true)
      expect(supportsNativeToolCalling('deepseek-r1:8b')).toBe(false)
    })
  })
})
