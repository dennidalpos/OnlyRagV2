import { describe, it, expect } from 'vitest'
import {
  evaluateTaskComplexity,
  findMatchingInstalledModel,
  type ComplexityEvaluationContext,
} from './complexityEvaluator'

describe('Complexity Evaluator Domain Unit Tests', () => {
  it('should route short lookup queries to fast tier', () => {
    const res = evaluateTaskComplexity('what is the syntax for useEffect hook in React?')
    expect(res.tier).toBe('fast')
    expect(res.tierName).toBe('Fast Tier')
    expect(res.isEscalated).toBe(false)
  })

  it('should route Italian quick questions to fast tier', () => {
    const res = evaluateTaskComplexity('spiegami come si usa useState')
    expect(res.tier).toBe('fast')
    expect(res.badgeLabel).toContain('Fast')
  })

  it('should route standard coding instructions to standard tier', () => {
    const res = evaluateTaskComplexity('Create a new UserCard component with avatar and status badge')
    expect(res.tier).toBe('standard')
    expect(res.tierName).toBe('Standard Tier')
  })

  it('should route deep keywords like architecture, deadlock or memory leak to deep reasoning tier', () => {
    const res1 = evaluateTaskComplexity('Refactor the state architecture to prevent memory leak')
    expect(res1.tier).toBe('deep_reasoning')
    expect(res1.tierName).toContain('Deep Reasoning')

    const res2 = evaluateTaskComplexity('Analizza questo deadlock nella gestione dei task concorrenti')
    expect(res2.tier).toBe('deep_reasoning')
  })

  it('should auto-escalate to deep reasoning on tool failure or error stack traces', () => {
    const ctx: ComplexityEvaluationContext = {
      hasRecentToolFailure: true,
      errorCountInHistory: 1,
    }
    const res = evaluateTaskComplexity('Fix the component', ctx)
    expect(res.tier).toBe('deep_reasoning')
    expect(res.isEscalated).toBe(true)
    expect(res.tierName).toBe('Escalated Deep Reasoning Tier')
  })

  it('should de-escalate back to standard when consecutiveSuccessCount >= 2 via circuit breaker', () => {
    const ctx: ComplexityEvaluationContext = {
      hasRecentToolFailure: false,
      errorCountInHistory: 1,
      consecutiveSuccessCount: 2,
    }
    const res = evaluateTaskComplexity('Create a simple helper function', ctx)
    expect(res.tier).toBe('standard')
    expect(res.isEscalated).toBe(false)
  })

  it('should find matching installed models accurately with fuzzy tags', () => {
    const available = ['qwen2.5-coder:7b', 'llama3.1:8b', 'deepseek-r1:8b']
    expect(findMatchingInstalledModel('qwen2.5-coder:7b', available)).toBe('qwen2.5-coder:7b')
    expect(findMatchingInstalledModel('qwen2.5-coder', available)).toBe('qwen2.5-coder:7b')
    expect(findMatchingInstalledModel('deepseek-r1:8b', available)).toBe('deepseek-r1:8b')
    expect(findMatchingInstalledModel('unknown-model:latest', available)).toBe(null)
  })
})
