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
    expect(res.tierName).toContain('Fast')
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

  it('should scale deep reasoning fallbacks to coding models on mid-range VRAM profiles (8GB GPU)', () => {
    const ctxMid: ComplexityEvaluationContext = {
      safeVramBudgetGB: 4.5,
      vramTotalMB: 8192,
      availableModels: ['deepseek-r1:7b', 'deepseek-r1:14b'],
    }
    const res = evaluateTaskComplexity('Refactor memory architecture and optimize thread lockups', ctxMid)
    expect(res.tier).toBe('deep_reasoning')
    expect(res.modelName).toBe('deepseek-r1:7b')
  })

  it('should scale deep reasoning fallbacks to lightweight models on legacy/CPU profiles (< 6GB)', () => {
    const ctxLow: ComplexityEvaluationContext = {
      safeVramBudgetGB: 1.5,
      vramTotalMB: 0,
      availableModels: ['deepseek-r1:1.5b', 'deepseek-r1:14b'],
    }
    const res = evaluateTaskComplexity('Refactor memory architecture and optimize thread lockups', ctxLow)
    expect(res.tier).toBe('deep_reasoning')
    expect(res.modelName).toBe('deepseek-r1:1.5b')
  })

  it('should allow larger reasoning models on extreme VRAM profiles (24GB+)', () => {
    const ctxExtreme: ComplexityEvaluationContext = {
      safeVramBudgetGB: 16.5,
      vramTotalMB: 24576,
      availableModels: ['qwen2.5-coder:32b', 'deepseek-r1:32b', 'qwen2.5-coder:14b'],
    }
    const res = evaluateTaskComplexity('Refactor memory architecture and optimize thread lockups', ctxExtreme)
    expect(res.tier).toBe('deep_reasoning')
    // A 32B-class reasoning model, i.e. far above what the mid-range profile is offered.
    // Which 32B tag wins is decided by findMatchingInstalledModel's loose base match, not by
    // the cascade order — the cascade's own budget ordering is covered directly in
    // hardwareModelCatalog.test.ts (buildFallbackChain).
    expect(res.modelName).toBe('deepseek-r1:32b')
  })

  it('should prefer the curated head of the catalog cascade when it is installed', () => {
    const ctxExtreme: ComplexityEvaluationContext = {
      safeVramBudgetGB: 16.5,
      vramTotalMB: 24576,
      availableModels: ['gpt-oss:20b', 'qwen2.5-coder:14b'],
    }
    const res = evaluateTaskComplexity('Refactor memory architecture and optimize thread lockups', ctxExtreme)
    expect(res.tier).toBe('deep_reasoning')
    expect(res.modelName).toBe('gpt-oss:20b')
    expect(res.isFallback).toBe(false)
  })

  it('should keep a CPU-only host on models it can actually run, not merely hold in RAM', () => {
    // 32GB of system RAM would "fit" a 14B model, but a CPU-only tool loop needs the
    // CPU throughput budget instead (CPU_INFERENCE_WEIGHT_BUDGET_GB).
    const ctxCpu: ComplexityEvaluationContext = {
      hardwareProfile: 'Auto',
      vramTotalMB: 0,
      availableModels: ['qwen2.5-coder:14b', 'qwen2.5-coder:3b'],
    }
    const res = evaluateTaskComplexity('Refactor memory architecture and optimize thread lockups', ctxCpu)
    expect(res.tier).toBe('deep_reasoning')
    expect(res.modelName).toBe('qwen2.5-coder:3b')
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
