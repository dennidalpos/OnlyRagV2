import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateAvailableOutputTokens } from '../../../shared/domain/agent/contextWindowCalculator'
import { ollamaAppService } from './ollamaAppService'
import { describeInvalidStructuredResponse, generateStructuredWithRecovery } from './structuredGenerationRecovery'

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: { generateStructured: vi.fn() },
}))

const baseRequest = {
  model: 'qwen3:4b',
  systemPrompt: 'Return a JSON object.',
  userContent: '{"request":"build dashboard"}',
  format: { type: 'object' },
  think: false,
  options: { num_ctx: 4096, num_predict: 128 },
}

describe('generateStructuredWithRecovery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retries length truncation only after expanding the output budget', async () => {
    vi.mocked(ollamaAppService.generateStructured)
      .mockResolvedValueOnce({
        status: 'incomplete',
        content: '{',
        error: 'Ollama response incomplete (length)',
        doneReason: 'length',
      })
      .mockResolvedValueOnce({ status: 'complete', content: '{"ok":true}' })

    const result = await generateStructuredWithRecovery(baseRequest, () => ({
      status: 'valid',
      data: { ok: true },
    }))

    expect(result).toMatchObject({ status: 'success', attempts: 2 })
    const retried = vi.mocked(ollamaAppService.generateStructured).mock.calls[1][0]
    expect(retried.options?.num_predict).toBe(calculateAvailableOutputTokens(`${retried.systemPrompt}\n${retried.userContent}`, 4096))
    expect(retried.options?.num_predict).toBeGreaterThan(128)
  })

  it('does not repeat an identical request when the context window is already fully allocated', async () => {
    const maximum = calculateAvailableOutputTokens(`${baseRequest.systemPrompt}\n${baseRequest.userContent}`, 4096)
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'incomplete',
      content: '{',
      error: 'Ollama response incomplete (length)',
      doneReason: 'length',
    })

    const result = await generateStructuredWithRecovery(
      {
        ...baseRequest,
        options: { ...baseRequest.options, num_predict: maximum },
      },
      () => ({ status: 'invalid', error: 'unused' }),
    )

    expect(result).toMatchObject({ status: 'error', attempts: 1 })
    if (result.status !== 'error') throw new Error('Expected recovery failure')
    expect(result.error).toContain('no larger output budget is available')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledTimes(1)
  })
})

describe('describeInvalidStructuredResponse', () => {
  it('names why the model stopped, what it spent, and the edges of what it wrote', () => {
    const line = describeInvalidStructuredResponse(
      'gpt-oss:20b',
      2,
      { content: 'Here is the plan:\n{"milestones": [', doneReason: 'stop', evalCount: 812, promptEvalCount: 4100, thinkingChars: 5200 },
      { think: false, options: { num_predict: 2048 } },
      'Response is not valid JSON',
    )

    expect(line).toContain('gpt-oss:20b (call 2/2): Response is not valid JSON')
    expect(line).toContain('done_reason=stop')
    expect(line).toContain('output_tokens=812')
    expect(line).toContain('num_predict=2048')
    expect(line).toContain('thinking_chars=5200')
    expect(line).toContain('head="Here is the plan: {\\"milestones\\": ["')
  })
})
