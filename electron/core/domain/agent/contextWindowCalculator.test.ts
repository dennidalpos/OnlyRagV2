import { describe, it, expect } from 'vitest'
import { calculateAvailableOutputTokens, countPromptTokens } from '../../../../shared/domain/agent/contextWindowCalculator'

describe('Context Window Calculator Domain Unit Tests', () => {
  it('uses all prompt-adjusted space inside the selected context window', () => {
    const prompt = 'Create a concise JSON plan for a responsive dashboard.'
    expect(calculateAvailableOutputTokens(prompt, 8192, 256)).toBe(8192 - countPromptTokens(prompt) - 256)
    expect(calculateAvailableOutputTokens('x'.repeat(100_000), 2048, 256)).toBe(1)
  })

  it('approximates long single-character runs instead of encoding them', () => {
    const started = Date.now()
    // BPE is quadratic on such a run: exact encoding of 100k characters takes seconds.
    expect(countPromptTokens(`abc ${'='.repeat(100_000)} def`)).toBe(countPromptTokens('abc   def') + Math.ceil(100_000 / 3.5))
    expect(Date.now() - started).toBeLessThan(1000)
    // Short runs, like separator lines, are still encoded exactly.
    expect(countPromptTokens('='.repeat(80))).toBeLessThan(80 / 3.5)
  })
})
