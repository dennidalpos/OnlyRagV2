import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewPlanRequestCoverage } from './planRequestCoverage'
import { ollamaAppService } from './ollamaAppService'
import type { PlanMilestone } from '../../../shared/domain/agent/planAndSolveGraph'
import { calculateAvailableOutputTokens } from '../../../shared/domain/agent/contextWindowCalculator'

vi.mock('./ollamaAppService', () => ({ ollamaAppService: { generateStructured: vi.fn() } }))

const request = {
  model: 'local-model',
  systemPrompt: 'Plan',
  userContent: '{}',
  format: {},
  think: false,
  host: 'http://localhost:11434',
  keepAlive: '30m',
  options: { num_ctx: 8192 },
}
const prompt = 'Create Dashboard and Tasks.\nPrepare MongoDB and Redis boundaries without implementing them yet.'
const milestones: PlanMilestone[] = [
  {
    id: 'm-1',
    title: 'Create pages',
    status: 'pending',
    acceptanceCriteria: ['Dashboard and Tasks are reachable from navigation.'],
  },
]

function respond(requirements: unknown[]) {
  vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({ status: 'complete', content: JSON.stringify({ requirements }) })
}
const covered = {
  requestLine: 1,
  status: 'covered',
  evidence: [1],
  reason: 'Both pages are planned.',
}

describe('reviewPlanRequestCoverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reports omitted deferred integrations and preserves the original request', async () => {
    respond([
      covered,
      {
        requestLine: 2,
        status: 'missing',
        evidence: [],
        reason: 'No service-boundary criteria exist.',
      },
    ])
    const error = await reviewPlanRequestCoverage(request, prompt, milestones, [])

    expect(error).toContain('MongoDB and Redis boundaries')
    expect(error).toContain('missing')
    const call = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    expect(JSON.parse(call.userContent)).toEqual({
      requestLines: prompt.split('\n').map((text, index) => ({ line: index + 1, text })),
      planEvidence: [{ id: 1, source: 'planned', statement: milestones[0].acceptanceCriteria![0] }],
      confirmedDecisions: [],
    })
    expect(call).toMatchObject({ model: request.model, host: request.host, think: false, keepAlive: '30m' })
    expect(call.options?.num_predict).toBe(calculateAvailableOutputTokens(`${call.systemPrompt}\n${call.userContent}`, 8192))
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
  })

  it('accepts explicit preparation criteria without requiring deferred implementation', async () => {
    const criterion = 'Service boundaries for MongoDB and Redis exist; no clients or connections are implemented.'
    respond([
      covered,
      {
        requestLine: 2,
        status: 'covered',
        evidence: [2],
        reason: 'Preparation stays deferred.',
      },
    ])
    expect(
      await reviewPlanRequestCoverage(
        request,
        prompt,
        [
          ...milestones,
          {
            id: 'm-2',
            title: 'Prepare services',
            status: 'pending',
            acceptanceCriteria: [criterion],
          },
        ],
        [],
      ),
    ).toBeUndefined()
  })

  it('rejects contradicted constraints on an unrelated non-web request', async () => {
    respond([
      {
        requestLine: 1,
        status: 'contradicted',
        evidence: [1],
        reason: 'The public output format changes.',
      },
    ])
    expect(
      await reviewPlanRequestCoverage(
        request,
        'Aggiungi un filtro. Non modificare il formato CSV.',
        [
          {
            id: 'm-1',
            title: 'Change exporter',
            status: 'pending',
            acceptanceCriteria: ['The exporter writes JSON instead of CSV.'],
          },
        ],
        [],
      ),
    ).toContain('contradicted')
  })

  it.each([
    [{ ...covered, requestLine: 99 }, 'unavailable request line'],
    [{ ...covered, evidence: [99] }, 'unavailable plan evidence'],
    [{ ...covered, evidence: [] }, 'no plan evidence'],
    [{ ...covered, status: 'context' }, 'context cannot cite plan evidence'],
  ])('rejects ungrounded review citations %#', async (requirement, message) => {
    respond([requirement])
    expect(await reviewPlanRequestCoverage(request, prompt, milestones, [])).toContain(message)
  })

  it('accepts retained verified evidence', async () => {
    respond([{ requestLine: 1, status: 'covered', evidence: [1], reason: 'Already verified.' }])
    expect(
      await reviewPlanRequestCoverage(
        request,
        'Keep CSV export.',
        [],
        [
          {
            interventionId: 'prior',
            summary: 'CSV export works',
            verificationReferences: ['npm test'],
          },
        ],
      ),
    ).toBeUndefined()
  })

  it('rejects a review that silently omits another request line', async () => {
    respond([covered])
    expect(await reviewPlanRequestCoverage(request, prompt, milestones, [])).toContain('omitted request lines: 2: Prepare MongoDB')
  })

  it('keeps original line indices across blanks and checks headings explicitly', async () => {
    respond([
      { requestLine: 1, status: 'context', evidence: [], reason: 'Section heading.' },
      { ...covered, requestLine: 3 },
    ])
    expect(await reviewPlanRequestCoverage(request, '# Pages\r\n\r\nCreate Dashboard and Tasks.', milestones, [])).toBeUndefined()
    const input = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].userContent)
    expect(input.requestLines).toEqual([
      { line: 1, text: '# Pages' },
      { line: 3, text: 'Create Dashboard and Tasks.' },
    ])
  })

  it.each([
    { status: 'complete' as const, content: '{}' },
    { status: 'complete' as const, content: '{"requirements":[]}' },
    { status: 'incomplete' as const, content: '{', error: 'length limit' },
    { status: 'transport_error' as const, content: '', error: 'connection refused' },
  ])('fails closed on invalid or unavailable review %#', async (response) => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(response)
    expect(await reviewPlanRequestCoverage(request, prompt, milestones, [])).toBeTruthy()
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
  })

  it('returns a thrown transport failure to the planner recovery', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockRejectedValue(new Error('socket closed'))
    expect(await reviewPlanRequestCoverage(request, prompt, milestones, [])).toContain('socket closed')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
  })
})
