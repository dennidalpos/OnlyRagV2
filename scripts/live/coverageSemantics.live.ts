import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RequestCoverageLedger, CoverageEvidence, PlanCoverageClaim } from '../../shared/domain/agent/requestCoverageLedger'
import { validateRequestLedger, validateCoverageClaims } from '../../shared/domain/agent/requestCoverageLedger'
import { reviewPlanRequestCoverage } from '../../electron/core/application/planRequestCoverage'
import { LIVE_RUN_ROOT } from './agentLiveHarness'
import { createQwen35Campaign, QWEN35_MODEL } from './qwen35Campaign'

const fixturePath = 'scripts/live/fixtures/requestCoverageCases.json'
const fixture = fs.readFileSync(fixturePath)
const digest = createHash('sha256').update(fixture).digest('hex')
const frozenCases = JSON.parse(fixture.toString('utf8')).cases as Array<{
  name: string
  ledger: RequestCoverageLedger
  evidence: CoverageEvidence[]
  claims: PlanCoverageClaim[]
  expectedAccepted: boolean
  decisions: string[]
}>
const replay = process.env.ONLYRAG_LIVE_COVERAGE_REPLAY
if (replay && !['conditional-reference-v1', 'remaining-reference-v1'].includes(replay)) throw new Error('Unknown coverage replay scope')
const label = replay ? `request-first-ledger-${replay}` : 'request-first-ledger-v1'
const conditionalNames = ['conditional-property-omitted', 'conditional-complete-counterpart']
const cases = replay ? frozenCases.filter((item) => conditionalNames.includes(item.name) === (replay === 'conditional-reference-v1')) : frozenCases
let campaign: Awaited<ReturnType<typeof createQwen35Campaign>>
const results: Array<Record<string, unknown>> = []
beforeAll(async () => {
  expect(digest).toBe('690a8d86c3070ba8ac2387a6289fef1780d04b1ec70f0cf3257c6f92e4f259e6')
  expect(frozenCases).toHaveLength(8)
  expect(cases).toHaveLength(replay === 'conditional-reference-v1' ? 2 : replay === 'remaining-reference-v1' ? 6 : 8)
  if (replay === 'conditional-reference-v1') expect(cases.map((item) => item.name)).toEqual(conditionalNames)
  for (const item of cases) {
    expect(validateRequestLedger(item.ledger, item.ledger.request)).toBeUndefined()
    expect(validateCoverageClaims(item.ledger, item.evidence, item.claims)).toBeUndefined()
  }
  // A failed replay is retained and cannot automatically run again.
  fs.mkdirSync(LIVE_RUN_ROOT, { recursive: true })
  fs.writeFileSync(
    path.join(LIVE_RUN_ROOT, `${label}-replay.json`),
    JSON.stringify({
      digest,
      startedAt: new Date().toISOString(),
      cases: cases.map((item) => item.name),
    }),
    { encoding: 'utf8', flag: 'wx' },
  )
  campaign = await createQwen35Campaign(label, {
    temperature: 1,
    top_p: 0.95,
    top_k: 20,
    min_p: 0,
    presence_penalty: 1.5,
    repeat_penalty: 1,
  })
  if (replay === 'remaining-reference-v1') {
    const runtime = JSON.parse(fs.readFileSync(path.join(campaign.root, 'runtime.json'), 'utf8'))
    expect(runtime.model.digest).toBe('c97eb11d70b1acdc88af01eef566c1fe4f7fbe93eb1afc06871132f293ff425a')
    expect(runtime.ollama).toBe('0.40.2')
  }
  fs.writeFileSync(path.join(campaign.root, 'frozen-cases.json'), fixture)
  fs.copyFileSync('shared/domain/agent/requestCoverageLedger.ts', path.join(campaign.root, 'sources', 'requestCoverageLedger.ts'))
  fs.copyFileSync('electron/core/application/requestCoverageLedgerDraft.ts', path.join(campaign.root, 'sources', 'requestCoverageLedgerDraft.ts'))
})
afterAll(async () => {
  if (campaign) {
    fs.writeFileSync(
      path.join(campaign.root, 'summary.json'),
      JSON.stringify(
        {
          digest,
          model: QWEN35_MODEL,
          think: true,
          numCtx: 16384,
          declaredCases: cases.length,
          completedCases: results.length,
          falseAcceptances: results.filter((item) => item.falseAcceptance).length,
          falseRejections: results.filter((item) => item.falseRejection).length,
          results,
        },
        null,
        2,
      ),
      'utf8',
    )
    await campaign.close()
  }
})

describe('live: one frozen request-first coverage replay', () => {
  it.each(cases)('$name', async (item) => {
    const start = Date.now()
    const first = campaign.requests.length
    const error = await reviewPlanRequestCoverage(
      {
        model: QWEN35_MODEL,
        host: campaign.settings.ollamaHost,
        think: true,
        systemPrompt: '',
        userContent: '',
        format: {},
        options: {
          ...campaign.settings.modelSamplingOverrides?.[QWEN35_MODEL],
          num_ctx: 16384,
        },
      },
      item.ledger,
      item.evidence,
      item.claims,
      item.decisions,
    )
    const wire = campaign.requests.slice(first)
    const response = wire.flatMap((request) =>
      fs
        .readFileSync(request.file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    )
    const content = response.map((chunk) => chunk.message?.content || chunk.response || '').join('')
    const thinking = response.map((chunk) => chunk.message?.thinking || chunk.thinking || '').join('')
    const result = {
      ...item,
      error: error || null,
      elapsedMs: Date.now() - start,
      content,
      thinking,
      final: response.at(-1),
      requests: wire,
      falseAcceptance: !item.expectedAccepted && !error,
      falseRejection: item.expectedAccepted && Boolean(error),
    }
    results.push(result)
    fs.writeFileSync(path.join(campaign.root, `${item.name}.json`), JSON.stringify(result, null, 2), 'utf8')
    console.log(`${item.name}: ${error || 'accepted'}; ${thinking.length} thinking characters; ${result.elapsedMs} ms`)
    expect(wire).toHaveLength(1)
    expect(thinking.length).toBeGreaterThan(0)
    expect(error || '').not.toMatch(/review failed|Invalid|omitted obligations/)
    if (item.expectedAccepted) expect(error).toBeUndefined()
    else expect(error).toContain('Plan request coverage failed')
  })
})
