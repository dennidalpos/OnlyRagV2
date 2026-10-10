import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { draftRequestLedger } from '../../electron/core/application/requestCoverageLedgerDraft'
import { validateRequestLedger, type RequestCoverageLedger } from '../../shared/domain/agent/requestCoverageLedger'
import { LIVE_RUN_ROOT } from './agentLiveHarness'
import { createQwen35Campaign, QWEN35_MODEL } from './qwen35Campaign'

const mode = process.env.ONLYRAG_LIVE_LEDGER_EXTRACTION
const campaigns: Record<string, { label: string; sourceSha256: string }> = {
  'approved-v1': { label: 'request-ledger-extraction-v1', sourceSha256: '17a14e9a51979a731bed300f62edd9eed6b25a3626dcffb2c2a65185bc75f826' },
  'field-roles-v1': { label: 'request-ledger-extraction-field-roles-v1', sourceSha256: 'c7e04e36d42d5c589db56100e236a688c2680b1421cf9bdd7235b3c1f6599679' },
  'target-invariants-v1': {
    label: 'request-ledger-extraction-target-invariants-v1',
    sourceSha256: '854a71b063849f37417f367362f58266f85dd6f2906ea4bd585084b4bed0c1d6',
  },
}
const selected = campaigns[mode || '']
if (mode !== 'preflight' && !selected) throw new Error('Choose preflight or an explicitly approved ledger extraction')
const extractionSourceSha256 = createHash('sha256').update(fs.readFileSync('electron/core/application/requestCoverageLedgerDraft.ts')).digest('hex')
const fixturePath = 'scripts/live/fixtures/requestCoverageCases.json'
const fixture = fs.readFileSync(fixturePath)
const digest = createHash('sha256').update(fixture).digest('hex')
const names = ['retained-card-only-global-claim', 'csv-only-global-claim', 'conditional-property-omitted', 'retained-choice-complete-counterpart']
const cases = (JSON.parse(fixture.toString('utf8')).cases as Array<{ name: string; ledger: RequestCoverageLedger; decisions: string[] }>).filter((item) =>
  names.includes(item.name),
)
let campaign: Awaited<ReturnType<typeof createQwen35Campaign>> | undefined
const results: Array<{ name: string; draft: RequestCoverageLedger | null; error: string | null; elapsedMs: number; actualCalls: number }> = []

beforeAll(async () => {
  expect(digest).toBe('690a8d86c3070ba8ac2387a6289fef1780d04b1ec70f0cf3257c6f92e4f259e6')
  expect(cases.map((item) => item.name)).toEqual(names)
  expect(new Set(cases.map((item) => item.ledger.request)).size).toBe(4)
  for (const item of cases) expect(validateRequestLedger(item.ledger, item.ledger.request)).toBeUndefined()
  if (mode === 'preflight') return

  expect(extractionSourceSha256).toBe(selected.sourceSha256)

  campaign = await createQwen35Campaign(selected.label, { temperature: 1, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 })
  const runtime = JSON.parse(fs.readFileSync(path.join(campaign.root, 'runtime.json'), 'utf8'))
  expect(runtime.model.digest).toBe('c97eb11d70b1acdc88af01eef566c1fe4f7fbe93eb1afc06871132f293ff425a')
  expect(runtime.ollama).toBe('0.40.2')
  fs.writeFileSync(path.join(campaign.root, 'frozen-cases.json'), fixture)
  for (const source of [
    'scripts/live/requestLedgerExtraction.live.ts',
    'electron/core/application/requestCoverageLedgerDraft.ts',
    'shared/domain/agent/requestCoverageLedger.ts',
    'electron/core/application/ollamaAppService.ts',
    'electron/core/infrastructure/http/ollamaHttpClient.ts',
    'electron/core/domain/agent/ollamaStructuredResponse.ts',
    'shared/domain/agent/contextWindowCalculator.ts',
  ]) {
    fs.copyFileSync(source, path.join(campaign.root, 'sources', path.basename(source)))
  }
  // A failed campaign consumes its marker; never automatically repeat extraction.
  fs.writeFileSync(path.join(LIVE_RUN_ROOT, `${selected.label}-replay.json`), JSON.stringify({ digest, names, startedAt: new Date().toISOString() }), {
    encoding: 'utf8',
    flag: 'wx',
  })
})

afterAll(async () => {
  if (!campaign) return
  try {
    fs.writeFileSync(
      path.join(campaign.root, 'summary.json'),
      JSON.stringify(
        {
          digest,
          extractionSourceSha256,
          declaredCases: 4,
          completedCases: results.length,
          actualCalls: campaign.requests.length,
          captureComplete: results.length === 4 && results.every((item) => !item.error && item.actualCalls === 1),
          semanticAccepted: null,
          humanConfirmed: false,
          limits:
            'Extraction capture only; independent semantic review and explicit human confirmation are required. No candidate, desktop or TaskLab qualification.',
          results,
        },
        null,
        2,
      ),
      'utf8',
    )
  } finally {
    await campaign.close()
  }
})

describe('live: frozen request-ledger extraction', () => {
  if (mode === 'preflight') {
    it('checks the unchanged four-request scope without Ollama or a spent marker', () => {
      expect(campaign).toBeUndefined()
      expect(results).toHaveLength(0)
    })
    return
  }
  it.each(cases)('$name: capture without confirmation or planning', async (item) => {
    if (!campaign) throw new Error('Ledger extraction campaign was not initialized')
    const started = Date.now()
    const first = campaign.requests.length
    const result: (typeof results)[number] = { name: item.name, draft: null, error: null, elapsedMs: 0, actualCalls: 0 }
    try {
      result.draft = await draftRequestLedger(
        {
          model: QWEN35_MODEL,
          host: campaign.settings.ollamaHost,
          think: true,
          systemPrompt: '',
          userContent: '',
          format: {},
          options: { ...campaign.settings.modelSamplingOverrides?.[QWEN35_MODEL], num_ctx: 16384 },
        },
        item.ledger.request,
        item.decisions,
      )
      expect(campaign.requests.length - first).toBe(1)
      expect(validateRequestLedger(result.draft, item.ledger.request)).toBeUndefined()
      const wire = JSON.parse(fs.readFileSync(path.join(campaign.root, `request-${first + 1}.json`), 'utf8'))
      expect(wire).toMatchObject({ model: QWEN35_MODEL, think: true, options: { num_ctx: 16384 } })
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      result.elapsedMs = Date.now() - started
      result.actualCalls = campaign.requests.length - first
      results.push(result)
      fs.writeFileSync(
        path.join(campaign.root, `${item.name}.json`),
        JSON.stringify({ ...result, referenceLedger: item.ledger, decisions: item.decisions }, null, 2),
        'utf8',
      )
    }
    // Semantic equivalence is reviewed from the entire draft, never inferred from schema validity.
    console.log(`${item.name}: captured unconfirmed draft; ${result.elapsedMs} ms`)
  })
})
