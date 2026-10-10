import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { reviewPlanRequestCoverage } from './planRequestCoverage'
import { ollamaAppService } from './ollamaAppService'
import {
  validateCoverageClaims,
  validateRequestLedger,
  type RequestCoverageLedger,
  type CoverageEvidence,
  type PlanCoverageClaim,
} from '../../../shared/domain/agent/requestCoverageLedger'

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: { generateStructured: vi.fn() },
}))
const cases = JSON.parse(fs.readFileSync('scripts/live/fixtures/requestCoverageCases.json', 'utf8')).cases as Array<{
  name: string
  ledger: RequestCoverageLedger
  evidence: CoverageEvidence[]
  claims: PlanCoverageClaim[]
  expectedAccepted: boolean
  decisions: string[]
}>
const sample = cases[1]
const request = {
  model: 'declared-fixture',
  systemPrompt: '',
  userContent: '',
  format: {},
  think: true,
  options: { num_ctx: 16384, temperature: 1, top_k: 20 },
}
const covered = {
  obligationId: 'r1',
  reason: 'All required buttons are explicitly covered.',
  evidence: [1],
  status: 'covered',
}
function respond(requirements: unknown[]) {
  vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
    status: 'complete',
    content: JSON.stringify({ requirements }),
  })
}
const review = () => reviewPlanRequestCoverage(request, sample.ledger, sample.evidence, sample.claims)

beforeEach(() => vi.resetAllMocks())
describe('confirmed request and deterministic claim gates', () => {
  it.each(cases)('accepts the structural contract of frozen case $name without inferring semantics', (item) => {
    expect(validateRequestLedger(item.ledger, item.ledger.request)).toBeUndefined()
    expect(validateCoverageClaims(item.ledger, item.evidence, item.claims)).toBeUndefined()
  })
  it('refuses stale confirmation, omitted source lines and duplicate identities', () => {
    expect(validateRequestLedger(sample.ledger, 'Different request')).toContain('different request')
    expect(validateRequestLedger({ ...sample.ledger, request: sample.ledger.request + '\nKeep JSON' }, sample.ledger.request + '\nKeep JSON')).toContain(
      'omitted',
    )
    expect(
      validateRequestLedger(
        {
          ...sample.ledger,
          obligations: [sample.ledger.obligations[0], sample.ledger.obligations[0]],
        },
        sample.ledger.request,
      ),
    ).toContain('Duplicate')
  })
  it.each([
    ['unknown obligation', { obligationId: 'unknown' }, 'Unavailable'],
    ['unknown evidence', { evidenceId: 50 }, 'Unavailable'],
    ['different subject', { subject: 'card buttons' }, 'subject differs'],
    ['extra condition', { conditions: ['only on cards'] }, 'conditions differ'],
    ['local claim for an open global inventory', { scope: 'local', targets: ['cards'] }, 'open global'],
  ])('refuses %s without a model call', async (_label, changes, error) => {
    const claims = [{ ...sample.claims[0], ...(changes as object) }] as PlanCoverageClaim[]
    expect(await reviewPlanRequestCoverage(request, sample.ledger, sample.evidence, claims)).toContain(error as string)
    expect(ollamaAppService.generateStructured).not.toHaveBeenCalled()
  })
  it('refuses missing obligations and duplicate coverage claims', () => {
    expect(validateCoverageClaims(sample.ledger, sample.evidence, [])).toContain('missing obligation')
    expect(validateCoverageClaims(sample.ledger, sample.evidence, [sample.claims[0], sample.claims[0]])).toContain('Duplicate')
  })
  it('refuses dropped conditions and incomplete closed inventories', () => {
    const conditional = cases[5]
    expect(validateCoverageClaims(conditional.ledger, conditional.evidence, [{ ...conditional.claims[0], conditions: [] }])).toContain('conditions differ')
    const closed = cases[3]
    expect(validateCoverageClaims(closed.ledger, closed.evidence, [closed.claims[0]])).toContain('incomplete target')
  })
  it('includes additional declared planned targets in a global closed obligation', () => {
    const closed = cases[3]
    const ledger = structuredClone(closed.ledger)
    ledger.obligations.push({
      ...ledger.obligations[0],
      id: 'r2',
      scope: 'local',
      targets: ['XML'],
    })
    expect(validateCoverageClaims(ledger, closed.evidence, [...closed.claims, { ...closed.claims[0], obligationId: 'r2', targets: ['XML'] }])).toContain(
      'incomplete target',
    )
  })
})
describe('semantic review preserves confirmed scope and budget', () => {
  it('passes original statements and exact confirmed ledger while preserving thinking sampling', async () => {
    respond([covered])
    expect(await review()).toBeUndefined()
    const call = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    expect(JSON.parse(call.userContent)).toEqual({
      confirmedLedger: sample.ledger,
      planEvidence: sample.evidence,
      coverageClaims: sample.claims,
      confirmedDecisions: [],
      compiledInterventions: [],
    })
    expect(call.options).toMatchObject({
      num_ctx: 16384,
      temperature: 1,
      top_k: 20,
    })
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
  })
  it.each([
    [[{ ...covered, obligationId: 'unknown' }], 'reference'],
    [[covered, covered], 'reference'],
    [[{ ...covered, evidence: [19] }], 'unassigned'],
    [[{ ...covered, status: 'context' }], 'Invalid'],
    [[{ ...covered, evidence: [] }], 'Invalid'],
    [[{ ...covered, status: 'missing' }], 'coverage failed'],
    [[{ ...covered, status: 'contradicted' }], 'coverage failed'],
  ])('refuses invalid or negative review %j', async (requirements, error) => {
    respond(requirements)
    expect(await review()).toContain(error)
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
  })
  it('refuses omission instead of reclassifying another obligation', async () => {
    respond([covered])
    const item = cases[7]
    expect(await reviewPlanRequestCoverage(request, item.ledger, item.evidence, item.claims, item.decisions)).toContain('omitted obligations')
  })
  it.each(['transport_error', 'incomplete'] as const)('returns truthful %s without retry', async (status) => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status,
      content: '',
      error: 'transport stopped',
    })
    expect(await review()).toContain('transport stopped')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
  })
  it('reports transport exceptions', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockRejectedValue(new Error('socket closed'))
    expect(await review()).toContain('socket closed')
  })
})
