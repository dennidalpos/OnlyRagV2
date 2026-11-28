import { describe, it, expect, beforeEach } from 'vitest'
import { clearTokenEstimateCache, estimateTokenCount, tokenEstimateCacheSize } from './tokenEstimate'

describe('tokenEstimate Unit Tests', () => {
  it('should return 0 for empty, null, or undefined input', () => {
    expect(estimateTokenCount('')).toBe(0)
    expect(estimateTokenCount(null)).toBe(0)
    expect(estimateTokenCount(undefined)).toBe(0)
  })

  it('should count a small number of tokens for a short sentence', () => {
    const count = estimateTokenCount('Hello world, this is a short test sentence.')
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(15)
  })

  it('should scale roughly linearly with repeated content', () => {
    const one = estimateTokenCount('The quick brown fox jumps over the lazy dog. ')
    const ten = estimateTokenCount('The quick brown fox jumps over the lazy dog. '.repeat(10))
    // Not exactly 10x (BPE can merge across repeats slightly differently) but well within an order of magnitude.
    expect(ten).toBeGreaterThan(one * 5)
    expect(ten).toBeLessThan(one * 15)
  })

  it('should return materially fewer tokens than characters for ordinary prose (the point of switching off a char-count heuristic)', () => {
    const text = 'function calculateDynamicContextWindow(promptLengthChars, hardwareMaxCtx) { return chosenBucket }'
    const count = estimateTokenCount(text)
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(text.length / 2)
  })

  it('should never throw on unusual input (emoji, unpaired surrogate, very long string)', () => {
    expect(() => estimateTokenCount('🚀🔥 emoji test 日本語')).not.toThrow()
    expect(() => estimateTokenCount('\uD800')).not.toThrow() // unpaired surrogate
    expect(() => estimateTokenCount('x'.repeat(10000))).not.toThrow()
  }, 15000)
})

describe('tokenEstimate cache bounds', () => {
  beforeEach(() => clearTokenEstimateCache())

  it('returns the cached count for an identical text', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20)
    expect(estimateTokenCount(text)).toBe(estimateTokenCount(text))
    expect(tokenEstimateCacheSize().entries).toBe(1)
  })

  it('keeps a bounded number of entries for many distinct drafts', () => {
    for (let i = 0; i < 1050; i++) estimateTokenCount(`prompt string variation #${i}`)
    expect(tokenEstimateCacheSize().entries).toBeLessThanOrEqual(200)
  })

  it('bounds the cached characters when every draft is a long template', () => {
    // Natural text: a run of one repeated character is the BPE tokenizer's slowest input and would time the test out.
    const template = 'The quick brown fox jumps over the lazy dog. '.repeat(2_300).slice(0, 100_000)
    for (let i = 0; i < 40; i++) estimateTokenCount(`${template}${i}`)
    expect(tokenEstimateCacheSize().chars).toBeLessThanOrEqual(2_000_000)
    expect(tokenEstimateCacheSize().entries).toBeLessThan(40)
  })
})
