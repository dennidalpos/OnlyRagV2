import { describe, it, expect } from 'vitest'
import {
  evaluateTaskComplexity,
  findMatchingInstalledModel,
  type ComplexityEvaluationContext,
} from './complexityEvaluator'

describe('Complexity Evaluator Domain Unit Tests', () => {
  it('should route short lookup queries in non-agent mode to fast tier', () => {
    const res = evaluateTaskComplexity('what is the syntax for useEffect?', { agentMode: 'ask' })
    expect(res.tier).toBe('fast')
    expect(res.tierName).toBe('Fast Tier')
    expect(res.isEscalated).toBe(false)
  })

  it('should route any prompt in agent mode to at least standard tier for reliable coding and tool calling', () => {
    const res1 = evaluateTaskComplexity('riprova', { agentMode: 'agent' })
    expect(res1.tier).toBe('standard')

    const res2 = evaluateTaskComplexity('continua', { agentMode: 'agent' })
    expect(res2.tier).toBe('standard')

    const res3 = evaluateTaskComplexity('Create a new UserCard component', { agentMode: 'agent' })
    expect(res3.tier).toBe('standard')
  })

  it('should route multi-file or large token prompts to deep reasoning tier', () => {
    const resMulti = evaluateTaskComplexity('Refactor state logic', { attachedFilesCount: 2 })
    expect(resMulti.tier).toBe('deep_reasoning')
    expect(resMulti.tierName).toContain('Deep Reasoning')

    const longPrompt = 'A'.repeat(800) + ' ' + 'B'.repeat(800)
    const resTokens = evaluateTaskComplexity(longPrompt, { contextSizeChars: 20000 })
    expect(resTokens.tier).toBe('deep_reasoning')
  })

  it('should route stack traces or diffs to deep reasoning tier', () => {
    const trace = 'Traceback (most recent call last):\n  File "app.py", line 12, in <module>\nTypeError: unsupported operand'
    const resTrace = evaluateTaskComplexity(trace)
    expect(resTrace.tier).toBe('deep_reasoning')
  })

  it('should auto-escalate to deep reasoning on tool failure or error stack traces', () => {
    const ctx: ComplexityEvaluationContext = {
      hasRecentToolFailure: true,
      errorCountInHistory: 1,
    }
    const res = evaluateTaskComplexity('Fix the component', ctx)
    expect(res.tier).toBe('deep_reasoning')
    expect(res.isEscalated).toBe(true)
    expect(res.tierName).toBe('Deep Reasoning')
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

  it('should maintain the workhorse coding model across evaluations', () => {
    const ctxCoding: ComplexityEvaluationContext = {
      settings: {
        codingModel: 'qwen2.5-coder:7b',
      } as any,
      availableModels: ['qwen2.5-coder:7b', 'deepseek-r1:14b'],
      attachedFilesCount: 2,
    }
    const res = evaluateTaskComplexity('Refactor state logic', ctxCoding)
    expect(res.tier).toBe('deep_reasoning')
    expect(res.modelName).toBe('qwen2.5-coder:7b')
  })

  it('should find matching installed models accurately with fuzzy tags', () => {
    const available = ['qwen2.5-coder:7b', 'llama3.1:8b', 'deepseek-r1:8b']
    expect(findMatchingInstalledModel('qwen2.5-coder:7b', available)).toBe('qwen2.5-coder:7b')
    expect(findMatchingInstalledModel('qwen2.5-coder', available)).toBe('qwen2.5-coder:7b')
    expect(findMatchingInstalledModel('deepseek-r1:8b', available)).toBe('deepseek-r1:8b')
    expect(findMatchingInstalledModel('unknown-model:latest', available)).toBe(null)
  })

  it('should match models across a namespace prefix (AGT4: consolidated with hardwareRecommendationEngine.ts, which previously had this namespace-strip step and complexityEvaluator.ts did not)', () => {
    const available = ['adrienbrault/biomistral-7b:q4_k_m', 'llama3.2:3b']
    expect(findMatchingInstalledModel('biomistral-7b:q4_k_m', available)).toBe('adrienbrault/biomistral-7b:q4_k_m')
  })
})
