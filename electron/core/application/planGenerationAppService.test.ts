import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planGenerationAppService } from './planGenerationAppService'
import { ollamaAppService } from './ollamaAppService'
import { isFalsifiableMilestone } from '../../../shared/domain/agent/planFalsifiabilityNormalizer'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import type { AgentPlan, AppSettings } from '../../../shared/types'

vi.mock('./ollamaAppService', () => ({ ollamaAppService: { generateStructured: vi.fn() } }))

const settings = {
  defaultModel: 'llama3.2',
  codingModel: 'qwen2.5-coder:7b',
  ollamaHost: '',
} as AppSettings

function complete(
  interventions: Array<{
    id: string
    objective: string
    filePaths: string[]
    acceptanceCriteria: string[]
    verificationCommand?: string
    sourceInterventionId?: string
  }>,
  overrides: Record<string, unknown> = {}
) {
  return {
    status: 'complete' as const,
    content: JSON.stringify({
      objective: 'Deliver the requested behavior',
      assumptions: [],
      interventions,
      supersededWork: [],
      ...overrides,
    }),
  }
}

function intervention(id: string, objective: string, filePath = 'src/task.ts') {
  return { id, objective, filePaths: [filePath], acceptanceCriteria: [`${objective} is observable`] }
}

function previousPlan(): AgentPlan {
  return {
    formatVersion: 2,
    id: 'plan-1',
    version: 1,
    prompt: 'Initial task',
    objective: 'Initial objective',
    decisions: [{ id: 'q-1', statement: 'Storage: local', source: 'explicit_user' }],
    retainedEvidence: [],
    supersededWork: [],
    status: 'approved',
    createdAt: '2026-09-08T00:00:00.000Z',
    milestones: [
      { ...intervention('m-1', 'Completed work'), title: 'Completed work', status: 'verified', verificationReferences: ['npm test'] },
      { ...intervention('m-2', 'Pending work'), title: 'Pending work', status: 'in_progress' },
    ],
  }
}

describe('PlanGenerationAppService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a canonical structured plan', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      intervention('m-1', 'The schema accepts credentials', 'src/schema.ts'),
      intervention('m-2', 'The endpoint logs users in', 'src/auth.ts'),
    ], {
      assumptions: [{ id: 'a-1', statement: 'Reuse the existing auth module', rationale: 'The project facts expose it.' }],
    }))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Add login', settings })

    expect(result).toMatchObject({ status: 'success', objective: 'Deliver the requested behavior' })
    expect(result.decisions[0]).toMatchObject({ source: 'assumption' })
    expect(result.milestones[0]).toMatchObject({ filePaths: ['src/schema.ts'] })
    expect(result.milestones.every(isFalsifiableMilestone)).toBe(true)
    const request = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    expect(request.model).toBe('qwen2.5-coder:7b')
    expect(request.keepAlive).toBe('30m')
    expect(request.options?.num_predict).toBe(
      HardwareProfileResolver.deriveNumPredict(request.options?.num_ctx || 0, 'plan')
    )
    expect(JSON.parse(request.userContent).request).toBe('Add login')
    expect(request.format).toEqual(expect.objectContaining({ type: 'object' }))
  })

  it('assigns canonical IDs instead of trusting model labels', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { ...intervention('first', 'Create schema'), id: 'first' },
      { ...intervention('second', 'Create endpoint'), id: 'step_two' },
    ], {
      assumptions: [{ id: 'assumption_one', statement: 'Reuse the stack', rationale: 'It is declared.' }],
    }))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Add login', settings })

    expect(result.milestones.map((item) => item.id)).toEqual(['m-1', 'm-2'])
    expect(result.decisions[0].id).toBe('a-1')
  })

  it('drops invented prior-work references from a fresh plan', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([{
      ...intervention('m-1', 'Persist locally'),
      sourceInterventionId: 'invented-prior-work',
    }], {
      supersededWork: [{ interventionId: 'also-invented', reason: 'Not selected.' }],
    }))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Persist locally', settings })

    expect(result.status).toBe('success')
    expect(result.milestones[0].sourceInterventionId).toBeUndefined()
    expect(result.supersededWork).toEqual([])
  })

  it('preserves evidence and requires every residual intervention to be carried or superseded', async () => {
    const previous = previousPlan()
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { ...intervention('m-1', 'Finish pending work'), sourceInterventionId: 'm-2' },
    ]))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Continue', settings, previousPlan: previous })
    expect(result.status, JSON.stringify(result)).toBe('success')
    expect(result.retainedEvidence).toEqual([
      { interventionId: 'm-1', summary: 'Completed work', verificationReferences: ['npm test'] },
    ])
    expect(result.decisions).toEqual(previous.decisions)

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      intervention('m-1', 'Replacement work'),
    ]))
    const dropped = await planGenerationAppService.generatePlanText({ prompt: 'Continue', settings, previousPlan: previous })
    expect(dropped).toMatchObject({ status: 'error', milestones: [] })
    expect(dropped.error).toContain('dropped pending interventions')
  })

  it('records superseded work explicitly', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      intervention('m-1', 'Replacement work'),
    ], { supersededWork: [{ interventionId: 'm-2', reason: 'The new request replaces it.' }] }))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Replace scope', settings, previousPlan: previousPlan() })
    expect(result.status).toBe('success')
    expect(result.supersededWork).toEqual([{ interventionId: 'm-2', reason: 'The new request replaces it.' }])
  })

  it('keeps transport, incomplete, schema, and invented-command failures non-executable', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'transport_error', content: '', error: 'connection refused',
    })
    const transport = await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })
    expect(transport).toMatchObject({ status: 'error', milestones: [] })
    expect(transport.error).toContain('connection refused')

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'incomplete', content: '{', error: 'Ollama response incomplete (length)',
    })
    const incomplete = await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })
    expect(incomplete).toMatchObject({ status: 'error', milestones: [] })
    expect(incomplete.error).toContain('Ollama response incomplete (length)')

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({ status: 'complete', content: '{}' })
    expect((await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })).error).toContain('Invalid plan response')

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { id: 'm-1', objective: 'Build passes', filePaths: [], acceptanceCriteria: ['Build exits 0'], verificationCommand: 'npm run invented' },
    ]))
    expect((await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })).error).toContain('unavailable verification command')
  })

  it('drops unavailable verification commands from file-backed interventions', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { ...intervention('m-1', 'Create manifest', 'package.json'), verificationCommand: 'npm init -y' },
    ]))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Create a React app', settings })

    expect(result.status).toBe('success')
    expect(result.milestones[0].verificationCommand).toBeUndefined()
  })

  it('uses the single schema correction to recover a malformed plan', async () => {
    vi.mocked(ollamaAppService.generateStructured)
      .mockResolvedValueOnce({ status: 'complete', content: '{}' })
      .mockResolvedValueOnce(complete([intervention('m-1', 'Corrected plan')]))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })

    expect(result.status).toBe('success')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledTimes(2)
    const correction = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[1][0].userContent)
    expect(correction.schemaCorrection.validationError).toContain('Invalid plan response')
  })

  describe('workspace facts', () => {
    let workspacePath: string

    beforeEach(() => {
      workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-plan-'))
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
        intervention('m-1', 'The dashboard renders', 'src/Dashboard.tsx'),
      ]))
    })

    afterEach(() => fs.rmSync(workspacePath, { recursive: true, force: true }))

    it('passes declared commands and keeps configured context', async () => {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', dev: 'vite' } }))
      await planGenerationAppService.generatePlanText({
        prompt: 'Add dashboard',
        model: 'llama3.1:8b',
        settings: { ...settings, modelContextLengths: { 'llama3.1:8b': 8192 } },
        workspacePath,
      })
      const request = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
      expect(JSON.parse(request.userContent).executableVerificationCommands).toContain('npm run build')
      expect(request.options).toEqual(expect.objectContaining({ num_ctx: 8192 }))
    })

    it('adds only the accepted greenfield stack and preserves existing infrastructure', async () => {
      const result = await planGenerationAppService.generatePlanText({ prompt: 'Create a React TypeScript web app', settings, workspacePath })
      expect(result.milestones.flatMap((item) => item.filePaths || [])).toEqual(expect.arrayContaining([
        'package.json', 'tsconfig.json', 'index.html', 'src/main.tsx',
      ]))
      const manifestStep = result.milestones.find((item) => item.filePaths?.includes('package.json'))
      expect(manifestStep?.proposedVerificationCommand).toBe('npm run build')
      expect(manifestStep).not.toHaveProperty('verificationCommand')

      fs.writeFileSync(path.join(workspacePath, 'package.json'), '{"name":"existing"}')
      const existing = await planGenerationAppService.generatePlanText({ prompt: 'Fix app', settings, workspacePath })
      expect(existing.milestones.flatMap((item) => item.filePaths || [])).not.toContain('index.html')
    })

    it('maps a command-only setup intervention to the canonical greenfield scaffold', async () => {
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([{
        id: 'm-1',
        objective: 'Initialize the project',
        filePaths: [],
        acceptanceCriteria: ['The project is initialized'],
        verificationCommand: 'npx create-react-app project-dashboard-task',
      }]))

      const result = await planGenerationAppService.generatePlanText({
        prompt: 'Create a React app',
        settings,
        workspacePath,
      })

      expect(result.status).toBe('success')
      const setup = result.milestones.find((item) => item.title === 'Initialize the project')
      expect(setup).toMatchObject({ filePaths: ['package.json'] })
      expect(setup?.verificationCommand).toBeUndefined()
    })

    it('does not impose web entrypoints on Python or non-web JavaScript', async () => {
      for (const prompt of ['Create a Python CLI', 'Create a Node.js CLI']) {
        const result = await planGenerationAppService.generatePlanText({ prompt, settings, workspacePath })
        const files = result.milestones.flatMap((item) => item.filePaths || [])
        expect(files).not.toContain('index.html')
        expect(files).not.toContain('src/main.tsx')
      }
    })

    it('does not re-scaffold a manifest-less workspace with existing files', async () => {
      fs.writeFileSync(path.join(workspacePath, 'app.py'), 'print("ready")')
      const result = await planGenerationAppService.generatePlanText({ prompt: 'Create a React app', settings, workspacePath })

      expect(result.milestones.flatMap((item) => item.filePaths || [])).not.toContain('index.html')
      expect(JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls.at(-1)![0].userContent).workspace).toBe('existing')
    })
  })
})
