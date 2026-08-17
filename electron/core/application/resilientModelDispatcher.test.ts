import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResilientModelDispatcher } from './resilientModelDispatcher'
import { AgentStreamTransport } from '../infrastructure/http/agentStreamTransport'
import type { OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'

vi.mock('../infrastructure/http/agentStreamTransport', () => ({
  AgentStreamTransport: {
    streamCompletion: vi.fn(),
  },
}))

// Mock fetch globally for VRAM eviction calls
const mockFetch = vi.fn().mockResolvedValue({ ok: true })
vi.stubGlobal('fetch', mockFetch)

/** Shared full-spec runtimeOpts fixture to satisfy OllamaRuntimeOptions type */
const baseRuntimeOpts: OllamaRuntimeOptions = {
  num_ctx: 16000,
  temperature: 0.2,
  top_p: 0.9,
  repeat_penalty: 1.1,
  maxContextChars: 48000,
}


describe('ResilientModelDispatcher Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true })
  })

  it('should return result from primary model when execution succeeds', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce('Primary model output')

    const plan = {
      primaryModel: 'deepseek-r1:8b',
      fallbackModel: 'llama3.2:3b',
      runtimeOpts: baseRuntimeOpts,
    }

    const sessionOpts = { prompt: 'Task prompt', isCancelled: () => false }

    const res = await ResilientModelDispatcher.executeWithFallback(plan, sessionOpts)

    expect(res.output).toBe('Primary model output')
    expect(res.usedModel).toBe('deepseek-r1:8b')
    expect(res.isFallback).toBe(false)
    expect(res.isEscalated).toBeUndefined()
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(1)
  })

  it('should gracefully degrade to fallback model when primary model fails', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockRejectedValueOnce(new Error('CUDA out of memory'))
      .mockResolvedValueOnce('Fallback model output')

    const plan = {
      primaryModel: 'deepseek-r1:8b',
      fallbackModel: 'llama3.2:3b',
      runtimeOpts: baseRuntimeOpts,
    }

    const onFallback = vi.fn()
    const sessionOpts = { prompt: 'Task prompt', isCancelled: () => false }

    const res = await ResilientModelDispatcher.executeWithFallback(plan, sessionOpts, onFallback)

    expect(res.output).toBe('Fallback model output')
    expect(res.usedModel).toBe('llama3.2:3b')
    expect(res.isFallback).toBe(true)
    expect(res.fallbackReason).toBe('CUDA out of memory')
    expect(onFallback).toHaveBeenCalledWith('deepseek-r1:8b', 'llama3.2:3b', 'CUDA out of memory')
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(2)
  })

  it('should throw error when primary and fallback models are identical and execution fails', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion).mockRejectedValueOnce(new Error('Network error'))

    const plan = {
      primaryModel: 'llama3.2:3b',
      fallbackModel: 'llama3.2:3b',
      runtimeOpts: { ...baseRuntimeOpts, num_ctx: 4096 },
    }

    const sessionOpts = { prompt: 'Task prompt', isCancelled: () => false }

    await expect(ResilientModelDispatcher.executeWithFallback(plan, sessionOpts)).rejects.toThrow('Network error')
  })

  it('should use intermediateModel when primary fails and intermediate succeeds', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockRejectedValueOnce(new Error('Deep model timeout'))
      .mockResolvedValueOnce('Intermediate Qwen output')

    const plan = {
      primaryModel: 'deepseek-r1:8b',
      intermediateModel: 'qwen2.5-coder:7b',
      fallbackModel: 'llama3.2:3b',
      runtimeOpts: baseRuntimeOpts,
    }

    const onFallback = vi.fn()
    const sessionOpts = { prompt: 'Task prompt', isCancelled: () => false }

    const res = await ResilientModelDispatcher.executeWithFallback(plan, sessionOpts, onFallback)

    expect(res.output).toBe('Intermediate Qwen output')
    expect(res.usedModel).toBe('qwen2.5-coder:7b')
    expect(res.isFallback).toBe(true)
    expect(onFallback).toHaveBeenCalledWith('deepseek-r1:8b', 'qwen2.5-coder:7b', 'Deep model timeout')
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(2)
  })

  it('should cascade to fallbackModel when both primary and intermediate fail', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockRejectedValueOnce(new Error('Deep model timeout'))
      .mockRejectedValueOnce(new Error('Intermediate OOM'))
      .mockResolvedValueOnce('Base Llama output')

    const plan = {
      primaryModel: 'deepseek-r1:8b',
      intermediateModel: 'qwen2.5-coder:7b',
      fallbackModel: 'llama3.2:3b',
      runtimeOpts: baseRuntimeOpts,
    }

    const onFallback = vi.fn()
    const sessionOpts = { prompt: 'Task prompt', isCancelled: () => false }

    const res = await ResilientModelDispatcher.executeWithFallback(plan, sessionOpts, onFallback)

    expect(res.output).toBe('Base Llama output')
    expect(res.usedModel).toBe('llama3.2:3b')
    expect(res.isFallback).toBe(true)
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(3)
  })

  it('should escalate to heavy tier when all lighter tiers fail and heavyEscalationModel is set', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockRejectedValueOnce(new Error('Primary OOM'))
      .mockRejectedValueOnce(new Error('Fallback OOM'))
      .mockResolvedValueOnce('Heavy 14B output')

    const plan = {
      primaryModel: 'deepseek-r1:8b',
      fallbackModel: 'llama3.2:3b',
      heavyEscalationModel: 'qwen2.5-coder:14b',
      runtimeOpts: baseRuntimeOpts,
    }

    const onFallback = vi.fn()
    const sessionOpts = { prompt: 'Complex task requiring 14B', isCancelled: () => false }

    const res = await ResilientModelDispatcher.executeWithFallback(plan, sessionOpts, onFallback)

    expect(res.output).toBe('Heavy 14B output')
    expect(res.usedModel).toBe('qwen2.5-coder:14b')
    expect(res.isFallback).toBe(true)
    expect(res.isEscalated).toBe(true)
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(3)
    // Verify that VRAM eviction was attempted before escalation
    expect(mockFetch).toHaveBeenCalled()
  })

  it('should call escalateToHeavyTier directly and evict VRAM', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce('Heavy direct output')

    const res = await ResilientModelDispatcher.escalateToHeavyTier(
      'qwen2.5-coder:14b',
      { prompt: 'task', isCancelled: () => false },
      { ...baseRuntimeOpts, num_ctx: 16000 },
      'Test escalation reason'
    )

    expect(res.usedModel).toBe('qwen2.5-coder:14b')
    expect(res.isEscalated).toBe(true)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('should evaluate getNextEscalationModel in order: Fast -> Standard -> Deep Reasoning -> Heavy', () => {
    const plan = {
      fastModel: 'llama3.2:3b',
      standardModel: 'qwen2.5-coder:7b',
      deepReasoningModel: 'deepseek-r1:8b',
      heavyEscalationModel: 'qwen2.5-coder:14b',
    }

    const fromFast = ResilientModelDispatcher.getNextEscalationModel('llama3.2:3b', plan)
    expect(fromFast?.nextModel).toBe('qwen2.5-coder:7b')
    expect(fromFast?.tierLabel).toContain('Standard Tier')
    expect(fromFast?.tier).toBe('standard')

    const fromStandard = ResilientModelDispatcher.getNextEscalationModel('qwen2.5-coder:7b', plan)
    expect(fromStandard?.nextModel).toBe('deepseek-r1:8b')
    expect(fromStandard?.tierLabel).toContain('Deep Reasoning Tier')
    expect(fromStandard?.tier).toBe('deep_reasoning')

    const fromDeep = ResilientModelDispatcher.getNextEscalationModel('deepseek-r1:8b', plan)
    expect(fromDeep?.nextModel).toBe('qwen2.5-coder:14b')
    expect(fromDeep?.tierLabel).toContain('Heavy Tier')
    expect(fromDeep?.tier).toBe('heavy')

    const fromHeavy = ResilientModelDispatcher.getNextEscalationModel('qwen2.5-coder:14b', plan)
    expect(fromHeavy?.nextModel).toBe('llama3.2:3b')
    expect(fromHeavy?.tierLabel).toContain('Fast Tier')
    expect(fromHeavy?.tier).toBe('fast')
  })
})
