import { describe, it, expect } from 'vitest'
import { estimateTokenCount } from './tokenEstimate'

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
    expect(() => estimateTokenCount('x'.repeat(50000))).not.toThrow()
  })
})
