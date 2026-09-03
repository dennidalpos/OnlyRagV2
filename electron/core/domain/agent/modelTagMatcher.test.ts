import { describe, it, expect } from 'vitest'
import {
  findMatchingInstalledModel,
  isOllamaModelInstalled,
  parseModelTagComponents,
  isTagCompatible,
} from '../../../../shared/domain/agent/modelTagMatcher'

describe('ModelTagMatcher Domain Unit Tests', () => {
  describe('parseModelTagComponents', () => {
    it('should parse bare model name', () => {
      const parsed = parseModelTagComponents('llama3.2')
      expect(parsed.baseName).toBe('llama3.2')
      expect(parsed.tag).toBe('')
      expect(parsed.namespace).toBe('')
    })

    it('should parse model name with tag', () => {
      const parsed = parseModelTagComponents('qwen2.5-coder:7b')
      expect(parsed.baseName).toBe('qwen2.5-coder')
      expect(parsed.tag).toBe('7b')
      expect(parsed.namespace).toBe('')
    })

    it('should parse model name with namespace and tag', () => {
      const parsed = parseModelTagComponents('adrienbrault/biomistral-7b:q4_k_m')
      expect(parsed.namespace).toBe('adrienbrault')
      expect(parsed.baseName).toBe('biomistral-7b')
      expect(parsed.tag).toBe('q4_k_m')
    })
  })

  describe('isTagCompatible', () => {
    it('should allow empty or latest tags to match anything', () => {
      expect(isTagCompatible('', '7b')).toBe(true)
      expect(isTagCompatible('latest', '7b')).toBe(true)
      expect(isTagCompatible('7b', 'latest')).toBe(true)
    })

    it('should allow compatible quant tags for same size', () => {
      expect(isTagCompatible('7b', '7b-instruct-q4_k_m')).toBe(true)
      expect(isTagCompatible('q4_k_m', '7b-instruct-q4_k_m')).toBe(true)
    })

    it('should reject different parameter size tags', () => {
      expect(isTagCompatible('1.5b', '7b')).toBe(false)
      expect(isTagCompatible('14b', '7b')).toBe(false)
      expect(isTagCompatible('32b', '8b')).toBe(false)
    })
  })

  describe('findMatchingInstalledModel', () => {
    it('should match exact model names case-insensitively', () => {
      const available = ['Qwen2.5-Coder:7B', 'Llama3.1:8B']
      expect(findMatchingInstalledModel('qwen2.5-coder:7b', available)).toBe('Qwen2.5-Coder:7B')
    })

    it('should match :latest equivalence in both directions', () => {
      const available1 = ['llama3.2:latest']
      expect(findMatchingInstalledModel('llama3.2', available1)).toBe('llama3.2:latest')

      const available2 = ['llama3.2']
      expect(findMatchingInstalledModel('llama3.2:latest', available2)).toBe('llama3.2')
    })

    it('should match across namespace prefixes', () => {
      const available = ['adrienbrault/biomistral-7b:q4_k_m']
      expect(findMatchingInstalledModel('biomistral-7b:q4_k_m', available)).toBe('adrienbrault/biomistral-7b:q4_k_m')
      expect(findMatchingInstalledModel('adrienbrault/biomistral-7b:q4_k_m', available)).toBe('adrienbrault/biomistral-7b:q4_k_m')
    })

    it('should match base model with compatible quantization tags', () => {
      const available = ['qwen2.5-coder:7b-instruct-q4_k_m']
      expect(findMatchingInstalledModel('qwen2.5-coder:7b', available)).toBe('qwen2.5-coder:7b-instruct-q4_k_m')
      expect(findMatchingInstalledModel('qwen2.5-coder', available)).toBe('qwen2.5-coder:7b-instruct-q4_k_m')
    })

    it('CRITICAL: should prevent substring shadowing where shorter generic models shadow specific coder models', () => {
      // When target is qwen2.5-coder:7b and available has qwen:7b before qwen2.5-coder:7b-instruct-q4_k_m,
      // it MUST match qwen2.5-coder:7b-instruct-q4_k_m, NOT qwen:7b!
      const available = ['qwen:7b', 'qwen2.5-coder:7b-instruct-q4_k_m']
      const matched = findMatchingInstalledModel('qwen2.5-coder:7b', available)
      expect(matched).toBe('qwen2.5-coder:7b-instruct-q4_k_m')

      // When bare target qwen2.5-coder is searched, it should match qwen2.5-coder:7b-instruct-q4_k_m, NOT qwen:7b
      const matchedBare = findMatchingInstalledModel('qwen2.5-coder', available)
      expect(matchedBare).toBe('qwen2.5-coder:7b-instruct-q4_k_m')
    })

    it('CRITICAL: should distinguish vision models from text models', () => {
      const available = ['llama3.2-vision:11b', 'llama3.2:3b']
      expect(findMatchingInstalledModel('llama3.2', available)).toBe('llama3.2:3b')
      expect(findMatchingInstalledModel('llama3.2:3b', available)).toBe('llama3.2:3b')
      expect(findMatchingInstalledModel('llama3.2-vision:11b', available)).toBe('llama3.2-vision:11b')
      expect(findMatchingInstalledModel('llama3.2-vision', available)).toBe('llama3.2-vision:11b')
    })

    it('should return null when a model with a different size is requested and not installed', () => {
      const available = ['qwen:7b', 'qwen2.5-coder:7b']
      expect(findMatchingInstalledModel('qwen2.5-coder:14b', available)).toBeNull()
      expect(findMatchingInstalledModel('qwen2.5-coder:1.5b', available)).toBeNull()
    })

    it('should return null when no compatible model is found', () => {
      const available = ['qwen2.5-coder:7b', 'deepseek-r1:8b']
      expect(findMatchingInstalledModel('mistral:7b', available)).toBeNull()
      expect(findMatchingInstalledModel('', available)).toBeNull()
      expect(findMatchingInstalledModel('qwen2.5-coder:7b', [])).toBeNull()
    })
  })

  describe('isOllamaModelInstalled', () => {
    it('should return true for installed models and false for non-installed models', () => {
      const installed = ['qwen2.5-coder:7b', 'deepseek-r1:8b', 'nomic-embed-text:latest', 'adrienbrault/biomistral-7b:q4_k_m']
      expect(isOllamaModelInstalled('qwen2.5-coder:7b', installed)).toBe(true)
      expect(isOllamaModelInstalled('qwen2.5-coder', installed)).toBe(true)
      expect(isOllamaModelInstalled('nomic-embed-text', installed)).toBe(true)
      expect(isOllamaModelInstalled('biomistral-7b:q4_k_m', installed)).toBe(true)
      expect(isOllamaModelInstalled('qwen2.5-coder:1.5b', installed)).toBe(false)
      expect(isOllamaModelInstalled('qwen2.5-coder:14b', installed)).toBe(false)
      expect(isOllamaModelInstalled('llama3.1:8b', installed)).toBe(false)
      expect(isOllamaModelInstalled('mistral:7b', installed)).toBe(false)
    })
  })
})
