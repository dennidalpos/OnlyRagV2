import { describe, expect, it } from 'vitest'
import { compareContextAllocation } from './contextAllocation'

describe('compareContextAllocation', () => {
  it('reports a matching allocation when Ollama allocated at least the requested context', () => {
    expect(compareContextAllocation(8192, 8192)).toBe('matched')
    expect(compareContextAllocation(8192, 16384)).toBe('matched')
  })

  it('reports underallocation without changing the requested value', () => {
    expect(compareContextAllocation(16384, 4096)).toBe('underallocated')
  })

  it('reports unknown when either side is unavailable', () => {
    expect(compareContextAllocation(undefined, 4096)).toBe('unknown')
    expect(compareContextAllocation(8192, undefined)).toBe('unknown')
  })
})
