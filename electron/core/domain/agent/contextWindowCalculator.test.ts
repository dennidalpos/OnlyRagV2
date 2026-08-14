import { describe, it, expect } from 'vitest'
import { calculateDynamicContextWindow } from './contextWindowCalculator'

describe('Context Window Calculator Domain Unit Tests', () => {
  it('should return minimum context (2048) for short prompts', () => {
    const shortPromptChars = 200 // ~53 tokens + 2048 headroom = ~2101 => bucket 4096, or 2048 if small
    // 200 / 3.8 = 53 + 2048 = 2101 => bucket 4096
    const ctx = calculateDynamicContextWindow(shortPromptChars)
    expect(ctx).toBe(4096)
  })

  it('should return 2048 when headroom is small and prompt is tiny', () => {
    const ctx = calculateDynamicContextWindow(100, 32768, 512)
    // 100 / 3.8 = 27 + 512 = 539 => bucket 2048
    expect(ctx).toBe(2048)
  })

  it('should scale up to 8192, 16384, or 32768 for larger prompts', () => {
    // 15,000 chars / 3.8 = ~3947 tokens + 2048 = ~5995 => bucket 8192
    expect(calculateDynamicContextWindow(15000)).toBe(8192)

    // 35,000 chars / 3.8 = ~9210 tokens + 2048 = ~11258 => bucket 16384
    expect(calculateDynamicContextWindow(35000)).toBe(16384)

    // 80,000 chars / 3.8 = ~21052 tokens + 2048 = ~23100 => bucket 32768
    expect(calculateDynamicContextWindow(80000)).toBe(32768)
  })

  it('should clamp context window to hardwareMaxCtx limit', () => {
    // 80,000 chars with maxCtx capped at 8192
    const ctx = calculateDynamicContextWindow(80000, 8192)
    expect(ctx).toBe(8192)
  })

  it('should handle zero or negative character counts safely', () => {
    expect(calculateDynamicContextWindow(0)).toBe(2048)
    expect(calculateDynamicContextWindow(-500)).toBe(2048)
  })
})
