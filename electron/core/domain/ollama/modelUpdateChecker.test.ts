import { describe, it, expect } from 'vitest'
import {
  parseModelTag,
  normalizeDigest,
  hasDigestDiscrepancy,
} from './modelUpdateChecker'

describe('modelUpdateChecker Domain Unit Tests', () => {
  describe('normalizeDigest', () => {
    it('should strip sha256: prefix and normalize case', () => {
      expect(normalizeDigest('sha256:2A654D98E6FBA55D452B7043684E9B57A947E393BBFFA62485A7AAC05EE4EEFD'))
        .toBe('2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd')
      expect(normalizeDigest('2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd'))
        .toBe('2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd')
    })

    it('should handle empty or null values safely', () => {
      expect(normalizeDigest('')).toBe('')
      expect(normalizeDigest(null)).toBe('')
      expect(normalizeDigest(undefined)).toBe('')
    })
  })

  describe('parseModelTag', () => {
    it('should parse official library models with tags', () => {
      const res = parseModelTag('qwen2.5-coder:7b')
      expect(res).toEqual({
        namespace: 'library',
        model: 'qwen2.5-coder',
        tag: '7b',
      })
    })

    it('should parse official library models without tags (defaulting to latest)', () => {
      const res = parseModelTag('llama3.2')
      expect(res).toEqual({
        namespace: 'library',
        model: 'llama3.2',
        tag: 'latest',
      })
    })

    it('should parse namespaced models', () => {
      const res = parseModelTag('huggingface/deepseek-ai:latest')
      expect(res).toEqual({
        namespace: 'huggingface',
        model: 'deepseek-ai',
        tag: 'latest',
      })
    })

    it('should parse custom registry model paths gracefully', () => {
      const res = parseModelTag('myregistry.internal:5000/team/custom-model:v2')
      expect(res).toEqual({
        namespace: 'team',
        model: 'custom-model',
        tag: 'v2',
      })
    })

    it('should handle edge cases and whitespace', () => {
      expect(parseModelTag('  medgemma:4b  ')).toEqual({
        namespace: 'library',
        model: 'medgemma',
        tag: '4b',
      })
      expect(parseModelTag('')).toEqual({
        namespace: 'library',
        model: '',
        tag: 'latest',
      })
    })
  })

  describe('hasDigestDiscrepancy', () => {
    const digestA = '2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd'
    const digestB = '85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1'

    it('should return false when digests match (with or without sha256 prefix)', () => {
      expect(hasDigestDiscrepancy(digestA, digestA)).toBe(false)
      expect(hasDigestDiscrepancy(`sha256:${digestA}`, digestA.toUpperCase())).toBe(false)
    })

    it('should return true when digests differ', () => {
      expect(hasDigestDiscrepancy(digestA, digestB)).toBe(true)
      expect(hasDigestDiscrepancy(`sha256:${digestA}`, `sha256:${digestB}`)).toBe(true)
    })

    it('should return false if either digest is missing or invalid', () => {
      expect(hasDigestDiscrepancy(digestA, null)).toBe(false)
      expect(hasDigestDiscrepancy(undefined, digestB)).toBe(false)
      expect(hasDigestDiscrepancy('', '')).toBe(false)
    })
  })
})
