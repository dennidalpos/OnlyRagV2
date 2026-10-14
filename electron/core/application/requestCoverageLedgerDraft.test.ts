import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ollamaAppService } from './ollamaAppService'
import { logger } from '../infrastructure/logging/logger'
import { draftRequestLedger } from './requestCoverageLedgerDraft'

vi.mock('./ollamaAppService', () => ({ ollamaAppService: { generateStructured: vi.fn() } }))
vi.mock('../infrastructure/logging/logger', () => ({ logger: { log: vi.fn() } }))

const request = { model: 'fixture-model', systemPrompt: '', userContent: '', format: {}, options: { num_ctx: 8192 } }
const prompt = 'First requirement\n\nSecond requirement'
const ledger = {
  request: prompt,
  obligations: [
    {
      id: 'r1',
      sourceLines: [1, 3],
      requirement: 'First and second requirement',
      subject: 'application',
      scope: 'global',
      targets: [],
      closedInventory: false,
      conditions: [],
    },
  ],
}
const response = (value: unknown) => ({ status: 'complete' as const, content: JSON.stringify(value) })

describe('request coverage ledger draft', () => {
  beforeEach(() => vi.clearAllMocks())

  it('numbers original nonblank lines and retries one invalid reference without changing the request', async () => {
    const trace = vi.fn()
    vi.mocked(ollamaAppService.generateStructured)
      .mockResolvedValueOnce(response({ ...ledger, obligations: [{ ...ledger.obligations[0], sourceLines: [1, 2] }] }))
      .mockResolvedValueOnce(response(ledger))

    await expect(draftRequestLedger(request, prompt, [], undefined, trace)).resolves.toEqual(ledger)
    expect(ollamaAppService.generateStructured).toHaveBeenCalledTimes(2)
    const first = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].userContent)
    const second = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[1][0].userContent)
    expect(first).toMatchObject({
      request: prompt,
      sourceLines: [
        { line: 1, text: 'First requirement' },
        { line: 3, text: 'Second requirement' },
      ],
    })
    expect(second).toMatchObject({ request: prompt, correction: { validationError: 'Invalid source lines: r1' } })
    expect(logger.log).toHaveBeenCalledWith('WARN', 'RequestLedgerDraft', 'REQUEST_LEDGER_SOURCE_LINES_INVALID attempt=1')
    expect(trace.mock.calls.map(([phase]) => phase)).toEqual([
      'REQUEST LEDGER CALL 1',
      'REQUEST LEDGER RESPONSE 1',
      'REQUEST LEDGER VALIDATION 1',
      'REQUEST LEDGER CALL 2',
      'REQUEST LEDGER RESPONSE 2',
      'REQUEST LEDGER VALIDATION 2',
    ])
    expect(trace.mock.calls[2][1]).toBe('Invalid source lines: r1')
  })

  it('stops after a second invalid reference and preserves the final error', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      response({
        ...ledger,
        obligations: [{ ...ledger.obligations[0], sourceLines: [2] }],
      }),
    )
    await expect(draftRequestLedger(request, prompt, [])).rejects.toThrow('Invalid source lines: r1')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledTimes(2)
    expect(logger.log).toHaveBeenCalledWith('WARN', 'RequestLedgerDraft', 'REQUEST_LEDGER_SOURCE_LINES_INVALID attempt=2')
  })

  it('does not retry unrelated validation failures', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(response({ ...ledger, request: 'Different request' }))
    await expect(draftRequestLedger(request, prompt, [])).rejects.toThrow('Request coverage confirmation belongs to a different request')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
  })

  it('does not retry after cancellation', async () => {
    const controller = new AbortController()
    vi.mocked(ollamaAppService.generateStructured).mockImplementation(async () => {
      controller.abort(new Error('Cancelled'))
      return response({ ...ledger, obligations: [{ ...ledger.obligations[0], sourceLines: [2] }] })
    })
    await expect(draftRequestLedger(request, prompt, [], controller.signal)).rejects.toThrow('Cancelled')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
  })
})
