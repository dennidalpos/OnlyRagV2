import { describe, it, expect } from 'vitest'
import { calculateAvailableOutputTokens, countPromptTokens } from '../../../../shared/domain/agent/contextWindowCalculator'

describe('Context Window Calculator Domain Unit Tests', () => {
  it('uses all prompt-adjusted space inside the selected context window', () => {
    const prompt = 'Create a concise JSON plan for a responsive dashboard.'
    expect(calculateAvailableOutputTokens(prompt, 8192, 256)).toBe(8192 - countPromptTokens(prompt) - 256)
    expect(calculateAvailableOutputTokens('x'.repeat(100_000), 2048, 256)).toBe(1)
    // Exact BPE on 100k identical characters is the tokenizer's worst case (~5s under a loaded
    // suite), so this case gets its own budget instead of flaking against the 5s default.
  }, 30_000)
})
