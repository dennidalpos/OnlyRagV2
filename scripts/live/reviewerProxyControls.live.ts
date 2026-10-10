import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  validateRequestLedger,
  validateCoverageClaims,
  type RequestCoverageLedger,
  type CoverageEvidence,
  type PlanCoverageClaim,
} from '../../shared/domain/agent/requestCoverageLedger'
import type { PlanMilestone } from '../../shared/domain/agent/planAndSolveGraph'
import { reviewPlanRequestCoverage } from '../../electron/core/application/planRequestCoverage'
import { ollamaAppService } from '../../electron/core/application/ollamaAppService'
import { LIVE_RUN_ROOT } from './agentLiveHarness'
import { createQwen35Campaign, QWEN35_MODEL } from './qwen35Campaign'

type Control = {
  name: string
  payload: {
    confirmedLedger: RequestCoverageLedger
    planEvidence: CoverageEvidence[]
    coverageClaims: PlanCoverageClaim[]
    confirmedDecisions: string[]
    compiledInterventions: PlanMilestone[]
  }
  expectedAccepted: boolean
  expectedStatuses: Record<string, string>
}
const mode = process.env.ONLYRAG_LIVE_REVIEWER_PROXY || 'preflight'
if (!['preflight', 'approved-v1'].includes(mode)) throw new Error('Unknown reviewer control scope')
const label = 'request-ledger-reviewer-proxy-v1'
const origin = path.join(LIVE_RUN_ROOT, 'request-ledger-planning-evidence-inventory-v1-2026-10-10T19-38-28-448Z-00f5c79c')
const controlsBytes = fs.readFileSync(path.join(origin, 'reviewer-proxy-controls.json'))
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const controls = JSON.parse(controlsBytes.toString('utf8')).cases as Control[]
const sourcePins = {
  'electron/core/application/planRequestCoverage.ts': 'e56297878365f1ec4bb8db0fe722e2272b896ef9d140141f91988782ec4bb69c',
  'electron/core/application/planGenerationAppService.ts': 'ce77011d653fe9d068cf8c8c1a8850df8c105aadbd008ef508aa1da644391a52',
  'electron/core/application/requestCoverageLedgerDraft.ts': '854a71b063849f37417f367362f58266f85dd6f2906ea4bd585084b4bed0c1d6',
  'scripts/live/fixtures/requestCoverageCases.json': '690a8d86c3070ba8ac2387a6289fef1780d04b1ec70f0cf3257c6f92e4f259e6',
}
const sampling = { temperature: 1, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 }
let campaign: Awaited<ReturnType<typeof createQwen35Campaign>> | undefined
let activeControl: Control | undefined
let dispatched = 0
const results: Array<Record<string, unknown>> = []

beforeAll(async () => {
  expect(sha(controlsBytes)).toBe('99f105488d27fbdb85b2fbb9d2f03af2ab31b40ed01d0291e5f1029cfaba7e52')
  expect(controls.map((item) => item.name)).toEqual(['captured-proxy-declarations-negative', 'frozen-complete-counterpart-positive'])
  for (const [file, hash] of Object.entries(sourcePins)) expect(sha(fs.readFileSync(file))).toBe(hash)
  for (const item of controls) {
    const input = item.payload
    expect(validateRequestLedger(input.confirmedLedger, input.confirmedLedger.request)).toBeUndefined()
    expect(validateCoverageClaims(input.confirmedLedger, input.planEvidence, input.coverageClaims)).toBeUndefined()
    expect(Object.keys(item.expectedStatuses)).toEqual(input.confirmedLedger.obligations.map((obligation) => obligation.id))
  }
  const priorWire = JSON.parse(fs.readFileSync(path.join(origin, 'request-10.json'), 'utf8'))
  expect(controls[0].payload).toEqual(JSON.parse(priorWire.messages[1].content))
  const frozen = JSON.parse(fs.readFileSync('scripts/live/fixtures/requestCoverageCases.json', 'utf8')).cases
  const positive = frozen.find((item: { name: string }) => item.name === 'retained-choice-complete-counterpart')
  expect(controls[1].payload).toEqual({
    confirmedLedger: positive.ledger,
    planEvidence: positive.evidence,
    coverageClaims: positive.claims,
    confirmedDecisions: positive.decisions,
    compiledInterventions: [],
  })
  if (mode === 'preflight') return
  const marker = path.join(LIVE_RUN_ROOT, `${label}-replay.json`)
  expect(fs.existsSync(marker)).toBe(false)
  campaign = await createQwen35Campaign(label, sampling)
  const runtime = JSON.parse(fs.readFileSync(path.join(campaign.root, 'runtime.json'), 'utf8'))
  expect(runtime.ollama).toBe('0.40.2')
  expect(runtime.model.digest).toBe('c97eb11d70b1acdc88af01eef566c1fe4f7fbe93eb1afc06871132f293ff425a')
  fs.writeFileSync(path.join(campaign.root, 'reviewer-proxy-controls.json'), controlsBytes)
  for (const file of [
    ...Object.keys(sourcePins),
    'scripts/live/reviewerProxyControls.live.ts',
    'shared/domain/agent/requestCoverageLedger.ts',
    'shared/domain/agent/contextWindowCalculator.ts',
    'electron/core/application/ollamaAppService.ts',
    'electron/core/infrastructure/http/ollamaHttpClient.ts',
    'electron/core/domain/agent/ollamaStructuredResponse.ts',
  ])
    fs.copyFileSync(file, path.join(campaign.root, 'sources', path.basename(file)))
  // Retain a spent marker even if either capture fails.
  fs.writeFileSync(marker, JSON.stringify({ startedAt: new Date().toISOString(), maximumCalls: 2, sourcePins, controlsSha256: sha(controlsBytes) }), {
    encoding: 'utf8',
    flag: 'wx',
  })
  fs.copyFileSync(marker, path.join(campaign.root, 'spent-marker.json'))
  const generate = ollamaAppService.generateStructured.bind(ollamaAppService)
  // Validate scope before forwarding each unchanged native call to the real model.
  vi.spyOn(ollamaAppService, 'generateStructured').mockImplementation((request) => {
    expect(activeControl).toBeDefined()
    expect(dispatched).toBeLessThan(2)
    expect(request.model).toBe(QWEN35_MODEL)
    expect(request.think).toBe(true)
    expect(request.options?.num_ctx).toBe(16384)
    expect(JSON.parse(request.userContent)).toEqual(activeControl!.payload)
    expect(request.format).toHaveProperty('properties.requirements')
    for (const [key, value] of Object.entries(sampling)) expect(request.options).toHaveProperty(key, value)
    dispatched++
    activeControl = undefined
    return generate(request)
  })
})

afterAll(async () => {
  vi.restoreAllMocks()
  if (!campaign) return
  try {
    fs.writeFileSync(
      path.join(campaign.root, 'summary.json'),
      JSON.stringify({ sourcePins, declaredCases: 2, actualCalls: campaign.requests.length, completedCases: results.length, results }, null, 2),
      'utf8',
    )
  } finally {
    await campaign.close()
  }
})

describe('live: two frozen reviewer controls', () => {
  if (mode === 'preflight') {
    it('checks original controls and source pins without inference or a marker', () => {
      expect(campaign).toBeUndefined()
      expect(dispatched).toBe(0)
    })
    return
  }
  it.each(controls)('$name', async (item) => {
    if (!campaign) throw new Error('Reviewer campaign was not initialized')
    const first = campaign.requests.length
    const started = Date.now()
    activeControl = item
    const input = item.payload
    const error = await reviewPlanRequestCoverage(
      {
        model: QWEN35_MODEL,
        host: campaign.settings.ollamaHost,
        think: true,
        systemPrompt: '',
        userContent: '',
        format: {},
        options: { ...sampling, num_ctx: 16384 },
      },
      input.confirmedLedger,
      input.planEvidence,
      input.coverageClaims,
      input.confirmedDecisions,
      input.compiledInterventions,
    )
    const wires = campaign.requests.slice(first)
    const chunks = wires.flatMap((wire) =>
      fs
        .readFileSync(wire.file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    )
    const content = chunks.map((chunk) => chunk.message?.content || '').join('')
    const thinking = chunks.map((chunk) => chunk.message?.thinking || '').join('')
    const result = { ...item, content, thinking, error: error || null, elapsedMs: Date.now() - started, wires, final: chunks.at(-1) }
    results.push(result)
    fs.writeFileSync(path.join(campaign.root, `${item.name}.json`), JSON.stringify(result, null, 2), 'utf8')
    console.log(`${item.name}: ${error || 'accepted'}; ${result.elapsedMs} ms`)
    expect(wires).toHaveLength(1)
    expect(chunks.at(-1)?.done).toBe(true)
    expect(thinking.length).toBeGreaterThan(0)
    expect(error || '').not.toMatch(/review failed|Invalid|omitted obligations/)
    const requirements = JSON.parse(content).requirements as Array<{ obligationId: string; status: string; evidence: number[]; reason: string }>
    expect(requirements).toHaveLength(Object.keys(item.expectedStatuses).length)
    expect(Object.fromEntries(requirements.map((requirement) => [requirement.obligationId, requirement.status]))).toEqual(item.expectedStatuses)
    if (item.expectedAccepted) expect(error).toBeUndefined()
    else expect(error).toContain('Plan request coverage failed')
  })
})
