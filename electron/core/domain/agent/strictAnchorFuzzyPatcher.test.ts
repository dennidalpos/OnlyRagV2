import { describe, it, expect } from 'vitest'
import { StrictAnchorFuzzyPatcher } from './strictAnchorFuzzyPatcher'

describe('StrictAnchorFuzzyPatcher', () => {
  it('should allow unique target chunk match', () => {
    const file = 'function uniqueFunc() {\n  return 42;\n}'
    const chunk = 'return 42;'

    const res = StrictAnchorFuzzyPatcher.verifyUniqueMatch(file, chunk)
    expect(res.allowed).toBe(true)
    expect(res.matchedOccurrences).toBe(1)
  })

  it('should reject ambiguous duplicate target chunk matches', () => {
    const file = 'function a() {\n  return 42;\n}\nfunction b() {\n  return 42;\n}'
    const chunk = 'return 42;'

    const res = StrictAnchorFuzzyPatcher.verifyUniqueMatch(file, chunk)
    expect(res.allowed).toBe(false)
    expect(res.matchedOccurrences).toBe(2)
    expect(res.error).toContain('Ambiguous target chunk')
  })
})
