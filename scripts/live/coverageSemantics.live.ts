import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlanMilestone } from '../../shared/domain/agent/planAndSolveGraph'
import type { PlanEvidence } from '../../shared/types'
import { reviewPlanRequestCoverage } from '../../electron/core/application/planRequestCoverage'
import { LIVE_RUN_ROOT } from './agentLiveHarness'
import { createQwen35Campaign, QWEN35_MODEL } from './qwen35Campaign'

let campaign: Awaited<ReturnType<typeof createQwen35Campaign>>
beforeAll(async () => {
  campaign = await createQwen35Campaign('coverage-9b-thinking', {
    temperature: 1,
    top_p: 0.95,
    top_k: 20,
    min_p: 0,
    presence_penalty: 1.5,
    repeat_penalty: 1,
  })
})
afterAll(async () => campaign?.close())

function milestone(id: string, title: string, acceptanceCriteria: string[]): PlanMilestone {
  return { id, title, acceptanceCriteria, status: 'pending' }
}

async function review(label: string, prompt: string, milestones: PlanMilestone[], retained: PlanEvidence[] = [], decisions: string[] = []) {
  const start = Date.now()
  const firstRequest = campaign.requests.length
  const error = await reviewPlanRequestCoverage(
    {
      model: QWEN35_MODEL,
      host: campaign.settings.ollamaHost,
      think: true,
      systemPrompt: '',
      userContent: '',
      format: {},
      options: { ...campaign.settings.modelSamplingOverrides?.[QWEN35_MODEL], num_ctx: 16384 },
    },
    prompt,
    milestones,
    retained,
    decisions,
  )
  const wire = campaign.requests.slice(firstRequest)
  const response = wire.flatMap((item) =>
    fs
      .readFileSync(item.file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { message?: { content?: string; thinking?: string }; done?: boolean; eval_count?: number }),
  )
  const content = response.map((item) => item.message?.content || '').join('')
  const thinking = response.map((item) => item.message?.thinking || '').join('')
  fs.writeFileSync(
    path.join(campaign.root, `${label}.json`),
    JSON.stringify({ prompt, milestones, retained, decisions, error: error || null, elapsedMs: Date.now() - start, content, thinking, final: response.at(-1) }),
    'utf8',
  )
  console.log(`${label}: ${error || 'accepted'}; ${thinking.length} thinking characters; ${Date.now() - start} ms`)
  expect(wire).toHaveLength(1)
  expect(thinking.length, 'No real thinking was observed').toBeGreaterThan(0)
  expect(error || '', 'Review must return validated requirement classifications').not.toMatch(/review failed|Invalid plan|omitted request lines/)
  return { error, requirements: JSON.parse(content).requirements as Array<{ requestLine: number; status: string; evidence: number[] }> }
}

describe('live: Qwen 3.5 9B thinking coverage', () => {
  it('rejects the retained incomplete exact-prompt plan', async () => {
    const source = fs.readFileSync('docs/prompt_test_sequenza.txt', 'utf8')
    const prompt = source.slice(0, source.indexOf('\n-----------------------------------------')).trim()
    const planPath =
      process.env.ONLYRAG_LIVE_COVERAGE_PLAN_FILE || path.join(LIVE_RUN_ROOT, 'qualification-9b-coverage-indexed-20260930', 'plan-coverage-audit.json')
    const audit = JSON.parse(fs.readFileSync(planPath, 'utf8')) as { milestones: PlanMilestone[] }
    const result = await review('retained-incomplete', prompt, audit.milestones)
    expect(result.error).toContain('Plan request coverage failed')
    for (const line of [23, 25, 42, 43]) {
      expect(
        result.requirements.some((item) => item.requestLine === line && item.status === 'missing'),
        `False coverage on line ${line}`,
      ).toBe(true)
    }
  })

  it('accepts a repaired exact-prompt plan', async () => {
    const source = fs.readFileSync('docs/prompt_test_sequenza.txt', 'utf8')
    const prompt = source.slice(0, source.indexOf('\n-----------------------------------------')).trim()
    const planPath =
      process.env.ONLYRAG_LIVE_COVERAGE_PLAN_FILE || path.join(LIVE_RUN_ROOT, 'qualification-9b-coverage-indexed-20260930', 'plan-coverage-audit.json')
    const audit = JSON.parse(fs.readFileSync(planPath, 'utf8')) as { milestones: PlanMilestone[] }
    const repaired = [
      ...audit.milestones,
      milestone('global', 'Apply shared constraints to every page and component', [
        'The application is named Project Dashboard Task and uses React and Tailwind CSS mobile-first utilities.',
        'Every page and component is mobile-first and fully responsive from 320px to 1920px.',
        'Every button has a minimum touch target of 44x44 px.',
        'Avoid fixed widths whenever possible; every component remains inside its container.',
        'Every page and component uses responsive Flexbox/Grid layouts, spacing and typography.',
        'Reusable UI components are shared by Dashboard and Tasks.',
        'The interface is runnable and usable; validate at 320, 375, 768, 1024, 1440 and 1920 px and fix every overflow, clipping or spacing issue before continuing.',
      ]),
      milestone('forms', 'Implement responsive forms', [
        'Desktop forms use a multi-column layout when appropriate.',
        'Mobile forms have full-width inputs and vertically stacked buttons.',
      ]),
      milestone('boundaries', 'Keep future integrations deferred', [
        'Prepare the services folder and project structure for MongoDB, Redis, TodoWrite and Nuvolaris OpenServerless without implementing connections or clients.',
      ]),
    ]
    const result = await review('retained-repaired', prompt, repaired)
    expect(result.error).toBeUndefined()
    for (const line of [23, 25, 42, 43]) expect(result.requirements.some((item) => item.requestLine === line && item.status === 'covered')).toBe(true)
  })

  it('rejects local scope and omitted conditional CSV behavior', async () => {
    const prompt =
      'Export constraints:\nCSV and JSON exports preserve the source record order.\nIf CSV is requested, retain UTF-8 encoding and quote fields containing delimiters.\nPrepare storage adapters without connecting to external services.'
    const result = await review('csv-incomplete', prompt, [
      milestone('csv', 'Implement CSV exports', ['CSV exports preserve the source record order.']),
      milestone('storage', 'Prepare storage adapters', ['Storage adapters exist without external connections.']),
    ])
    expect(result.error).toContain('Plan request coverage failed')
    for (const line of [2, 3]) expect(result.requirements.some((item) => item.requestLine === line && item.status === 'missing')).toBe(true)
  })

  it('accepts explicit conditions, confirmed decisions and retained work', async () => {
    const prompt =
      'Export constraints:\nEvery export preserves the source record order.\nIf CSV is requested, retain UTF-8 encoding and quote fields containing delimiters.\nPrepare storage adapters without connecting to external services.\nKeep JSON export.\nUse a browser editor or a command-line editor; ask which.'
    const result = await review(
      'csv-complete',
      prompt,
      [
        milestone('exports', 'Preserve all export constraints', [
          'Every export preserves the source record order.',
          'If CSV is requested, retain UTF-8 encoding and quote fields containing delimiters.',
          'The editor stays command-line only as confirmed by the user.',
        ]),
        milestone('storage', 'Prepare storage adapters', ['Storage adapters exist without external connections.']),
      ],
      [{ interventionId: 'previous-json', summary: 'JSON export remains available', verificationReferences: ['npm test: JSON export regression passed'] }],
      ['Keep the editor command-line only; do not add a browser editor.'],
    )
    expect(result.error).toBeUndefined()
    for (const line of [2, 3, 4, 5, 6]) expect(result.requirements.some((item) => item.requestLine === line && item.status === 'covered')).toBe(true)
  })
})
