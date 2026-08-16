import { describe, it, expect } from 'vitest'
import { StagnationCircuitBreaker } from './stagnationCircuitBreaker'

describe('StagnationCircuitBreaker', () => {
  it('should trigger circuit breaker on no-mutation step threshold', () => {
    const breaker = new StagnationCircuitBreaker(3, 3)
    breaker.recordStep(false, false)
    breaker.recordStep(false, false)
    const check = breaker.recordStep(false, false)

    expect(check.shouldBreak).toBe(true)
    expect(check.reason).toContain('No-mutation stagnation streak')
  })

  it('should reset no-mutation streak on mutating tool', () => {
    const breaker = new StagnationCircuitBreaker(3, 3)
    breaker.recordStep(false, false)
    breaker.recordStep(false, false)
    breaker.recordStep(true, false) // Mutating tool resets streak

    const check = breaker.recordStep(false, false)
    expect(check.shouldBreak).toBe(false)
  })
})
