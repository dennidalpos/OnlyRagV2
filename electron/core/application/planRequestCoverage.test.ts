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
  it('binds the wire schema to each obligation and its assigned evidence', async () => {
    const item = cases[7]
    respond(
      item.ledger.obligations.map((obligation) => ({
        ...covered,
        obligationId: obligation.id,
        evidence: item.claims.filter((claim) => claim.obligationId === obligation.id).map((claim) => claim.evidenceId),
      })),
    )
    expect(await reviewPlanRequestCoverage(request, item.ledger, item.evidence, item.claims, item.decisions)).toBeUndefined()
    const format = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].format as {
      properties: { requirements: { minItems: number; maxItems: number; items: { oneOf: Array<{ properties: Record<string, unknown> }> } } }
    }
    const requirements = format.properties.requirements
    expect(requirements.minItems).toBe(item.ledger.obligations.length)
    expect(requirements.maxItems).toBe(item.ledger.obligations.length)
    expect(requirements.items.oneOf.map((variant) => variant.properties)).toEqual(
      item.ledger.obligations.map((obligation) => ({
        obligationId: { type: 'string', const: obligation.id },
        reason: { type: 'string', minLength: 1, maxLength: 240 },
        evidence: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: { type: 'number', const: item.claims.find((claim) => claim.obligationId === obligation.id)?.evidenceId },
        },
        status: { type: 'string', enum: ['covered', 'missing', 'contradicted'] },
      })),
    )
  })
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
    [[{ ...covered, evidence: [1, 1] }], 'duplicate coverage evidence'],
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
  it("refuses another obligation's existing evidence and duplicate identities at the exact result count", async () => {
    const item = cases[7]
    const requirements = item.ledger.obligations.map((obligation) => ({
      ...covered,
      obligationId: obligation.id,
      evidence: item.claims.filter((claim) => claim.obligationId === obligation.id).map((claim) => claim.evidenceId),
    }))
    respond(requirements.map((result, index) => (index === 0 ? { ...result, evidence: requirements[1].evidence } : result)))
    expect(await reviewPlanRequestCoverage(request, item.ledger, item.evidence, item.claims)).toContain('unassigned evidence')
    respond(requirements.map((result, index) => (index === 1 ? requirements[0] : result)))
    expect(await reviewPlanRequestCoverage(request, item.ledger, item.evidence, item.claims)).toContain('Invalid coverage obligation reference')
  })
  it('bounds multiple assigned evidence values without permitting an unrelated ID', async () => {
    const item = cases[3]
    respond([{ ...covered, evidence: item.claims.map((claim) => claim.evidenceId) }])
    expect(await reviewPlanRequestCoverage(request, item.ledger, item.evidence, item.claims)).toBeUndefined()
    const format = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].format as {
      properties: { requirements: { items: { oneOf: Array<{ properties: { evidence: unknown } }> } } }
    }
    expect(format.properties.requirements.items.oneOf[0].properties.evidence).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: { type: 'number', enum: [1, 2] },
    })
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
