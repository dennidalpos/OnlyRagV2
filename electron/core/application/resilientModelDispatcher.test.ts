import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResilientModelDispatcher } from './resilientModelDispatcher'
import { AgentStreamTransport } from '../infrastructure/http/agentStreamTransport'

vi.mock('../infrastructure/http/agentStreamTransport', () => ({
  AgentStreamTransport: {
    streamCompletion: vi.fn(),
  },
}))

describe('ResilientModelDispatcher Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return result from primary model when execution succeeds', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion).mockResolvedValueOnce('Primary model output')

    const plan = {
      primaryModel: 'deepseek-r1:8b',
      fallbackModel: 'llama3.2:3b',
      runtimeOpts: { num_ctx: 16000, temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 },
    }

    const sessionOpts = {
      prompt: 'Task prompt',
      isCancelled: () => false,
    }

    const res = await ResilientModelDispatcher.executeWithFallback(plan, sessionOpts)

    expect(res.output).toBe('Primary model output')
    expect(res.usedModel).toBe('deepseek-r1:8b')
    expect(res.isFallback).toBe(false)
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(1)
  })

  it('should gracefully degrade to fallback model when primary model fails', async () => {
    vi.mocked(AgentStreamTransport.streamCompletion)
      .mockRejectedValueOnce(new Error('CUDA out of memory'))
      .mockResolvedValueOnce('Fallback model output')

    const plan = {
      primaryModel: 'deepseek-r1:8b',
      fallbackModel: 'llama3.2:3b',
      runtimeOpts: { num_ctx: 16000, temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 },
    }

    const onFallback = vi.fn()
    const sessionOpts = {
      prompt: 'Task prompt',
      isCancelled: () => false,
    }

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
      runtimeOpts: { num_ctx: 4096, temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 },
    }

    const sessionOpts = {
      prompt: 'Task prompt',
      isCancelled: () => false,
    }

    await expect(ResilientModelDispatcher.executeWithFallback(plan, sessionOpts)).rejects.toThrow('Network error')
    expect(AgentStreamTransport.streamCompletion).toHaveBeenCalledTimes(1)
  })
})
