import { describe, it, expect } from 'vitest'
import { evaluateTaskComplexity } from './complexityEvaluator'

describe('Complexity Evaluator Domain Unit Tests', () => {
  it('should route simple English queries to Fast Tier', () => {
    const res = evaluateTaskComplexity('what is Ollama?')
    expect(res.tier).toBe('fast')
    expect(res.tierName).toBe('Fast Tier')
    expect(res.badgeLabel).toContain('Fast')
  })

  it('should route simple Italian queries to Fast Tier', () => {
    const res1 = evaluateTaskComplexity('spiegami come funziona il chunking semantico')
    expect(res1.tier).toBe('fast')

    const res2 = evaluateTaskComplexity('elenca i modelli disponibili')
    expect(res2.tier).toBe('fast')

    const res3 = evaluateTaskComplexity('cos è LanceDB?')
    expect(res3.tier).toBe('fast')
  })

  it('should route refactoring and debugging queries in English to Deep Reasoning Tier', () => {
    const res = evaluateTaskComplexity('debug memory leak and refactor architecture in main process')
    expect(res.tier).toBe('deep_reasoning')
    expect(res.tierName).toBe('Deep Reasoning Tier')
    expect(res.badgeLabel).toContain('Deep Reasoning')
  })

  it('should route architecture and optimization queries in Italian to Deep Reasoning Tier', () => {
    const res = evaluateTaskComplexity('ottimizza la memoria ed esegui un refactoring della pipeline dei flussi')
    expect(res.tier).toBe('deep_reasoning')
    expect(res.tierName).toBe('Deep Reasoning Tier')
    expect(res.reasoning).toContain('architettura, refactoring profondo o ottimizzazione')
  })

  it('should route stack traces and error messages directly to Deep Reasoning Tier', () => {
    const errorPrompt = 'Fix this error: Traceback (most recent call last): File "main.py", line 12, in <module>'
    const res = evaluateTaskComplexity(errorPrompt)
    expect(res.tier).toBe('deep_reasoning')
    expect(res.reasoning).toContain('stack trace')
  })

  it('should route standard queries to Standard Tier', () => {
    const res = evaluateTaskComplexity('Create a simple helper function for path formatting')
    expect(res.tier).toBe('standard')
    expect(res.tierName).toBe('Standard Tier')
    expect(res.badgeLabel).toContain('Standard')
  })

  it('should escalate to Deep Reasoning when recent tool failure or auto-healing occurs', () => {
    const res = evaluateTaskComplexity('Create a helper function', {
      hasRecentToolFailure: true,
      errorCountInHistory: 1,
    })
    expect(res.tier).toBe('deep_reasoning')
    expect(res.isEscalated).toBe(true)
    expect(res.reasoning).toContain('Auto-healing')
  })

  it('should fallback gracefully to an installed model when preferred model is not pulled', () => {
    const customSettings = {
      complexityDeepModel: 'deepseek-r1:14b',
      complexityStandardModel: 'qwen2.5-coder:7b',
    } as any

    const availableModels = ['qwen2.5-coder:7b', 'llama3.2:3b']

    const res = evaluateTaskComplexity('refactor the database layer', {
      settings: customSettings,
      availableModels,
    })

    expect(res.tier).toBe('deep_reasoning')
    expect(res.modelName).toBe('qwen2.5-coder:7b')
    expect(res.isFallback).toBe(true)
  })

  it('should respect custom model settings when provided', () => {
    const customSettings = {
      complexityFastModel: 'llama3.2:3b',
      complexityStandardModel: 'qwen2.5-coder:7b',
      complexityDeepModel: 'deepseek-r1:8b',
    } as any

    const resFast = evaluateTaskComplexity('explain how chunking works', 0, 0, customSettings)
    expect(resFast.modelName).toBe('llama3.2:3b')

    const resDeep = evaluateTaskComplexity('security audit on file permissions', 0, 0, customSettings)
    expect(resDeep.modelName).toBe('deepseek-r1:8b')
  })

  it('should match Ollama models with quantization and instruct tag variations', () => {
    const customSettings = {
      complexityStandardModel: 'qwen2.5-coder:7b',
    } as any

    const availableModels = ['qwen2.5-coder:7b-instruct-q4_K_M', 'llama3.2:3b']

    const res = evaluateTaskComplexity('Create a simple helper function', {
      settings: customSettings,
      availableModels,
    })

    expect(res.tier).toBe('standard')
    expect(res.modelName).toBe('qwen2.5-coder:7b-instruct-q4_K_M')
    expect(res.isFallback).toBe(false)
  })

  it('should route test suite and type check queries to Deep Reasoning', () => {
    const resTest = evaluateTaskComplexity('Fix the failing test suite in vitest')
    expect(resTest.tier).toBe('deep_reasoning')

    const resType = evaluateTaskComplexity('Risolvi i type error e avvia la migrazione')
    expect(resType.tier).toBe('deep_reasoning')

    const resAudit = evaluateTaskComplexity('esegui un audit critico sui flussi e pipeline')
    expect(resAudit.tier).toBe('deep_reasoning')
  })
})
