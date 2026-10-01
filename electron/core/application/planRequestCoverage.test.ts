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

  it.each([true, 'low'])('preserves explicit sampling for thinking %s', async (think) => {
    respond([covered])
    await reviewPlanRequestCoverage(
      { ...request, think, options: { num_ctx: 8192, temperature: 0.6, top_k: 20 } },
      'Create Dashboard and Tasks.',
      milestones,
      [],
    )
    expect(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].options).toMatchObject({ temperature: 0.6, top_k: 20 })
  })

  it('keeps model sampling defaults when thinking is enabled without overrides', async () => {
    respond([covered])
    await reviewPlanRequestCoverage({ ...request, think: true }, 'Create Dashboard and Tasks.', milestones, [])
    expect(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].options).not.toHaveProperty('temperature')
  })

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
      planInterventions: [{ id: 'm-1', objective: 'Create pages', filePaths: [] }],
      planEvidence: [{ id: 1, source: 'planned', interventionId: 'm-1', statement: milestones[0].acceptanceCriteria![0] }],
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

  it('preserves distinct owners for identical local criteria', async () => {
    respond([{ requestLine: 1, status: 'covered', evidence: [1, 2], reason: 'Both editor and menu actions retain keyboard access.' }])
    const error = await reviewPlanRequestCoverage(
      request,
      'Editor and menu actions must remain keyboard accessible.',
      [
        {
          id: 'editor',
          title: 'Update editor actions',
          status: 'pending',
          filePaths: ['src/Editor.tsx'],
          acceptanceCriteria: ['Actions are keyboard accessible.'],
        },
        { id: 'menu', title: 'Update menu actions', status: 'pending', filePaths: ['src/Menu.tsx'], acceptanceCriteria: ['Actions are keyboard accessible.'] },
      ],
      [],
    )
    expect(error).toBeUndefined()
    const input = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].userContent)
    expect(input.planInterventions).toEqual([
      { id: 'editor', objective: 'Update editor actions', filePaths: ['src/Editor.tsx'] },
      { id: 'menu', objective: 'Update menu actions', filePaths: ['src/Menu.tsx'] },
    ])
    expect(input.planEvidence).toEqual([
      { id: 1, source: 'planned', interventionId: 'editor', statement: 'Actions are keyboard accessible.' },
      { id: 2, source: 'planned', interventionId: 'menu', statement: 'Actions are keyboard accessible.' },
    ])
  })

  it('keeps conditional children and confirmed choices in their original context', async () => {
    respond([
      { requestLine: 1, status: 'context', evidence: [], reason: 'Constraint heading.' },
      { requestLine: 2, status: 'covered', evidence: [1], reason: 'The condition and both retention constraints are explicit.' },
    ])
    const decisions = ['Keep the exporter command-line only.']
    expect(
      await reviewPlanRequestCoverage(
        request,
        'For optional exports:\n- If CSV is requested, retain column order and UTF-8 encoding.',
        [
          {
            id: 'export',
            title: 'Preserve optional exports',
            status: 'pending',
            acceptanceCriteria: ['If CSV is requested, retain column order and UTF-8 encoding.'],
          },
        ],
        [],
        decisions,
      ),
    ).toBeUndefined()
    const input = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].userContent)
    expect(input.requestLines).toEqual([
      { line: 1, text: 'For optional exports:' },
      { line: 2, text: '- If CSV is requested, retain column order and UTF-8 encoding.' },
    ])
    expect(input.confirmedDecisions).toEqual(decisions)
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
    const input = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].userContent)
    expect(input.planEvidence).toEqual([{ id: 1, source: 'retained', interventionId: 'prior', statement: 'CSV export works: npm test' }])
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
