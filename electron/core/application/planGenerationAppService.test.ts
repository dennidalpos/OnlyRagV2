import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planGenerationAppService, type PlanGenerationRequest } from './planGenerationAppService'
import { ollamaAppService } from './ollamaAppService'
import { isFalsifiableMilestone } from '../../../shared/domain/agent/planFalsifiabilityNormalizer'
import type { AgentPlan, AppSettings } from '../../../shared/types'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import * as planCompilation from '../../../shared/domain/agent/planCompilation'
import { calculateAvailableOutputTokens } from '../../../shared/domain/agent/contextWindowCalculator'
import { reviewPlanRequestCoverage } from './planRequestCoverage'

vi.mock('./planRequestCoverage', () => ({
  reviewPlanRequestCoverage: vi.fn(),
}))

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: {
    generateStructured: vi.fn(),
    getModelContextLength: vi.fn().mockResolvedValue(undefined),
    getModelMetrics: vi.fn().mockResolvedValue({}),
  },
}))

// A fixed 12 GB GPU / 32 GB host, so the hardware-derived context ceiling does not depend on the test machine.
vi.mock('../infrastructure/diagnostics/hardwareProbe', () => ({
  hardwareProbe: {
    getCachedGpuInfo: () => ({ hasNvidiaGpu: true, vramTotalMB: 12288 }),
    getMemoryInfo: () => ({ totalRAMGB: 32 }),
  },
}))

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
  overrides: Record<string, unknown> = {},
) {
  return {
    status: 'complete' as const,
    content: JSON.stringify({
      coverageClaims: [],
      objective: 'Deliver the requested behavior',
      assumptions: [],
      interventions,
      supersededWork: [],
      ...overrides,
    }),
  }
}

function intervention(id: string, objective: string, filePath = 'src/task.ts') {
  return {
    id,
    objective,
    filePaths: [filePath],
    acceptanceCriteria: [`${objective} is observable`],
  }
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
      {
        ...intervention('m-1', 'Completed work'),
        title: 'Completed work',
        status: 'verified',
        verificationReferences: ['npm test'],
      },
      {
        ...intervention('m-2', 'Pending work'),
        title: 'Pending work',
        status: 'in_progress',
      },
    ],
  }
}

function generateConfirmed(req: PlanGenerationRequest) {
  return planGenerationAppService.generatePlanText({
    ...req,
    confirmedCoverage: {
      request: req.prompt,
      obligations: [
        {
          id: 'r-1',
          sourceLines: req.prompt.split(/\r?\n/).flatMap((line, index) => (line.trim() ? [index + 1] : [])),
          requirement: req.prompt,
          subject: 'requested behavior',
          scope: 'global',
          targets: [],
          closedInventory: false,
          conditions: [],
        },
      ],
    },
  })
}

describe('PlanGenerationAppService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewPlanRequestCoverage).mockResolvedValue(undefined)
  })

  it('cancels between metadata and generation without dispatching a model request', async () => {
    let resolveContext!: (context: number | undefined) => void
    vi.mocked(ollamaAppService.getModelContextLength).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveContext = resolve
        }),
    )
    const pending = generateConfirmed({ prompt: 'Task', settings, operationId: 'cancel-metadata' })
    expect(planGenerationAppService.cancelPlanOperation('other-operation')).toBe(false)
    expect(planGenerationAppService.cancelPlanOperation('cancel-metadata')).toBe(true)
    resolveContext(16384)
    expect(await pending).toMatchObject({ status: 'error', milestones: [] })
    expect(ollamaAppService.generateStructured).not.toHaveBeenCalled()
    expect(planGenerationAppService.cancelPlanOperation('cancel-metadata')).toBe(false)
  })

  it('does not start a second candidate when cancellation occurs during review', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('m1', 'Task')]))
    vi.mocked(reviewPlanRequestCoverage).mockImplementationOnce(async () => {
      expect(planGenerationAppService.cancelPlanOperation('cancel-review')).toBe(true)
      return 'Plan request coverage failed'
    })
    expect(await generateConfirmed({ prompt: 'Task', settings, operationId: 'cancel-review' })).toMatchObject({ status: 'error', milestones: [] })
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
    expect(reviewPlanRequestCoverage).toHaveBeenCalledOnce()
  })

  it('extracts request scope without planning, then requires explicit request-bound confirmation', async () => {
    const ledger = {
      request: 'Add login',
      obligations: [
        {
          id: 'r1',
          sourceLines: [1],
          requirement: 'Add login',
          subject: 'login',
          scope: 'global' as const,
          targets: [],
          closedInventory: false,
          conditions: [],
        },
      ],
    }
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete',
      content: JSON.stringify(ledger),
    })
    const result = await planGenerationAppService.generatePlanText({
      prompt: 'Add login',
      settings,
    })
    expect(result).toMatchObject({
      status: 'scope_confirmation_required',
      scopeDraft: ledger,
      milestones: [],
    })
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
    expect(reviewPlanRequestCoverage).not.toHaveBeenCalled()
    vi.mocked(ollamaAppService.generateStructured).mockClear()
    const stale = await planGenerationAppService.generatePlanText({
      prompt: 'Different request',
      settings,
      confirmedCoverage: ledger,
    })
    expect(stale.status).toBe('error')
    expect(stale.error).toContain('different request')
    expect(ollamaAppService.generateStructured).not.toHaveBeenCalled()
  })

  it('retains an incomplete request extraction as an error with no automatic candidate or extraction retry', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'transport_error',
      content: '',
      error: 'Operation cancelled',
    })
    const result = await planGenerationAppService.generatePlanText({
      prompt: 'Task',
      settings,
    })
    expect(result).toMatchObject({ status: 'error', milestones: [] })
    expect(result.error).toContain('Operation cancelled')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
    expect(reviewPlanRequestCoverage).not.toHaveBeenCalled()
  })

  it('returns a canonical structured plan', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      complete([intervention('m-1', 'The schema accepts credentials', 'src/schema.ts'), intervention('m-2', 'The endpoint logs users in', 'src/auth.ts')], {
        assumptions: [
          {
            id: 'a-1',
            statement: 'Reuse the existing auth module',
            rationale: 'The project facts expose it.',
          },
        ],
      }),
    )

    const result = await generateConfirmed({ prompt: 'Add login', settings })

    expect(result).toMatchObject({
      status: 'success',
      objective: 'Deliver the requested behavior',
    })
    expect(result.decisions[0]).toMatchObject({ source: 'assumption' })
    expect(result.milestones[0]).toMatchObject({
      filePaths: ['src/schema.ts'],
    })
    expect(result.milestones.every(isFalsifiableMilestone)).toBe(true)
    const request = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    expect(request.model).toBe('qwen2.5-coder:7b')
    expect(request.keepAlive).toBe('30m')
    expect(request.options?.num_predict).toBe(calculateAvailableOutputTokens(`${request.systemPrompt}\n${request.userContent}`, request.options?.num_ctx || 0))
    expect(request.think).toBe(false)
    expect(JSON.parse(request.userContent).request).toBe('Add login')
    expect(request.format).toEqual(expect.objectContaining({ type: 'object' }))
  })

  it('assigns canonical IDs instead of trusting model labels', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      complete(
        [
          { ...intervention('first', 'Create schema'), id: 'first' },
          { ...intervention('second', 'Create endpoint'), id: 'step_two' },
        ],
        {
          assumptions: [
            {
              id: 'assumption_one',
              statement: 'Reuse the stack',
              rationale: 'It is declared.',
            },
          ],
        },
      ),
    )

    const result = await generateConfirmed({ prompt: 'Add login', settings })

    expect(result.milestones.map((item) => item.id)).toEqual(['m-1', 'm-2'])
    expect(result.decisions[0].id).toBe('a-1')
  })

  it('forwards only the selected model sampling preferences to planning and coverage', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('m-1', 'Create endpoint')]))
    const sampling = { temperature: 1, presence_penalty: 1.5, top_k: 20 }
    await generateConfirmed({
      prompt: 'Add login',
      settings: {
        ...settings,
        modelSamplingOverrides: {
          [settings.codingModel!]: sampling,
          other: { temperature: 0 },
        },
      },
    })
    expect(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].options).toMatchObject(sampling)
    expect(vi.mocked(reviewPlanRequestCoverage).mock.calls[0][0].options).toMatchObject(sampling)
  })

  it('clamps the saved setup window to the model trained context', async () => {
    vi.mocked(ollamaAppService.getModelContextLength).mockResolvedValueOnce(4096)
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('m-1', 'Create endpoint')]))

    await generateConfirmed({
      prompt: 'Add endpoint',
      settings: {
        ...settings,
        modelContextLengths: { 'qwen2.5-coder:7b': 32768 },
      },
    })

    const request = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    expect(request.options?.num_ctx).toBe(4096)
    expect(request.options?.num_predict).toBe(calculateAvailableOutputTokens(`${request.systemPrompt}\n${request.userContent}`, 4096))
  })

  it('drops invented prior-work references from a fresh plan', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      complete(
        [
          {
            ...intervention('m-1', 'Persist locally'),
            sourceInterventionId: 'invented-prior-work',
          },
        ],
        {
          supersededWork: [{ interventionId: 'also-invented', reason: 'Not selected.' }],
        },
      ),
    )

    const result = await generateConfirmed({
      prompt: 'Persist locally',
      settings,
    })

    expect(result.status).toBe('success')
    expect(result.milestones[0].sourceInterventionId).toBeUndefined()
    expect(result.supersededWork).toEqual([])
  })

  it('preserves evidence and requires every residual intervention to be carried or superseded', async () => {
    const previous = previousPlan()
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      complete([
        {
          ...intervention('m-1', 'Finish pending work'),
          sourceInterventionId: 'm-2',
        },
      ]),
    )

    const result = await generateConfirmed({
      prompt: 'Continue',
      settings,
      previousPlan: previous,
    })
    expect(result.status, JSON.stringify(result)).toBe('success')
    expect(result.retainedEvidence).toEqual([
      {
        interventionId: 'plan-1@1:m-1',
        summary: 'Completed work',
        verificationReferences: ['npm test'],
      },
    ])
    expect(result.decisions).toEqual(previous.decisions)

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('m-1', 'Replacement work')]))
    const dropped = await generateConfirmed({
      prompt: 'Continue',
      settings,
      previousPlan: previous,
    })
    expect(dropped).toMatchObject({ status: 'error', milestones: [] })
    expect(dropped.error).toContain('dropped pending interventions')
  })

  it('records superseded work explicitly', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      complete([intervention('m-1', 'Replacement work')], {
        supersededWork: [{ interventionId: 'm-2', reason: 'The new request replaces it.' }],
      }),
    )

    const result = await generateConfirmed({
      prompt: 'Replace scope',
      settings,
      previousPlan: previousPlan(),
    })
    expect(result.status).toBe('success')
    expect(result.supersededWork).toEqual([{ interventionId: 'm-2', reason: 'The new request replaces it.' }])
  })

  it('retains distinct verified work when a later revision reuses canonical intervention IDs', async () => {
    const previous = previousPlan()
    previous.milestones = previous.milestones.filter((item) => item.status === 'verified')
    previous.retainedEvidence = [
      {
        interventionId: 'm-1',
        summary: 'Earlier verified scaffold',
        verificationReferences: ['scaffold render test passed'],
      },
    ]
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('m-1', 'Add next feature')]))
    const result = await generateConfirmed({
      prompt: 'Continue',
      settings,
      previousPlan: previous,
    })
    expect(result.status).toBe('success')
    expect(result.retainedEvidence.map((item) => item.summary)).toEqual(['Earlier verified scaffold', 'Completed work'])
    expect(new Set(result.retainedEvidence.map((item) => item.interventionId)).size).toBe(2)
  })

  it('keeps transport, incomplete, schema, and invented-command failures non-executable', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'transport_error',
      content: '',
      error: 'connection refused',
    })
    const transport = await generateConfirmed({ prompt: 'Task', settings })
    expect(transport).toMatchObject({ status: 'error', milestones: [] })
    expect(transport.error).toContain('connection refused')

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'incomplete',
      content: '{',
      error: 'Ollama response incomplete (length)',
    })
    const incomplete = await generateConfirmed({ prompt: 'Task', settings })
    expect(incomplete).toMatchObject({ status: 'error', milestones: [] })
    expect(incomplete.error).toContain('Ollama response incomplete (length)')

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete',
      content: '{}',
    })
    expect((await generateConfirmed({ prompt: 'Task', settings })).error).toContain('Invalid plan response')

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      complete([
        {
          id: 'm-1',
          objective: 'Build passes',
          filePaths: [],
          acceptanceCriteria: ['Build exits 0'],
          verificationCommand: 'npm run invented',
        },
      ]),
    )
    expect((await generateConfirmed({ prompt: 'Task', settings })).error).toContain('unavailable verification command')
  })

  it('audits failed and zero-milestone plan generation as failed sessions', async () => {
    const logSessionStart = vi.spyOn(codingAgentLogger, 'logSessionStart').mockImplementation(() => {})
    const logPlanGeneration = vi.spyOn(codingAgentLogger, 'logPlanGeneration').mockImplementation(() => {})
    const logSessionEnd = vi.spyOn(codingAgentLogger, 'logSessionEnd').mockImplementation(() => {})
    const debugSettings = { ...settings, enableCodingAgentDebugLog: true }

    try {
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
        status: 'transport_error',
        content: '',
        error: 'connection refused',
      })
      await generateConfirmed({
        operationId: 'plan-audit-failure',
        prompt: 'Task',
        settings: debugSettings,
      })
      expect(logSessionEnd).toHaveBeenCalledWith('plan-audit-failure', 0, false, expect.stringContaining('connection refused'))

      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('m-1', 'Create the requested behavior')]))
      const compilePlanMilestones = vi.spyOn(planCompilation, 'compilePlanMilestones').mockReturnValueOnce([])
      const zeroMilestoneResult = await generateConfirmed({
        operationId: 'plan-audit-empty',
        prompt: 'Task',
        settings: debugSettings,
      })
      compilePlanMilestones.mockRestore()

      expect(zeroMilestoneResult).toMatchObject({
        status: 'error',
        error: 'Plan response contained no executable interventions',
      })
      expect(logSessionEnd).toHaveBeenCalledWith('plan-audit-empty', 0, false, expect.stringContaining('no executable interventions'))
    } finally {
      logSessionStart.mockRestore()
      logPlanGeneration.mockRestore()
      logSessionEnd.mockRestore()
    }
  })

  it('drops unavailable verification commands from file-backed interventions', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      complete([
        {
          ...intervention('m-1', 'Create manifest', 'package.json'),
          verificationCommand: 'npm init -y',
        },
      ]),
    )

    const result = await generateConfirmed({
      prompt: 'Create a React app',
      settings,
    })

    expect(result.status).toBe('success')
    expect(result.milestones[0].verificationCommand).toBeUndefined()
  })

  it('uses the single schema correction to recover a malformed plan', async () => {
    vi.mocked(ollamaAppService.generateStructured)
      .mockResolvedValueOnce({ status: 'complete', content: '{}' })
      .mockResolvedValueOnce(complete([intervention('m-1', 'Corrected plan')]))

    const result = await generateConfirmed({ prompt: 'Task', settings })

    expect(result.status).toBe('success')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledTimes(2)
    const correction = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[1][0].userContent)
    expect(correction.schemaCorrection.validationError).toContain('Invalid plan response')
  })

  it('corrects missing request coverage within the existing planning budget', async () => {
    vi.mocked(ollamaAppService.generateStructured)
      .mockResolvedValueOnce(complete([intervention('first', 'Create the UI')]))
      .mockResolvedValueOnce(complete([intervention('second', 'Prepare the service boundary without connecting external storage')]))
    vi.mocked(reviewPlanRequestCoverage)
      .mockResolvedValueOnce('Plan request coverage failed: services folder (missing): Add a deferred service boundary.')
      .mockResolvedValueOnce(undefined)

    const result = await generateConfirmed({
      prompt: 'Create the UI and a services folder for future integrations',
      settings,
    })

    expect(result.status).toBe('success')
    expect(result.milestones[0].title).toContain('service boundary')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledTimes(2)
    expect(reviewPlanRequestCoverage).toHaveBeenCalledTimes(2)
    const correction = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[1][0].userContent)
    expect(correction.schemaCorrection.validationError).toContain('services folder (missing)')
  })

  it('keeps an uncovered plan non-executable after two candidates', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('first', 'Create the UI')]))
    vi.mocked(reviewPlanRequestCoverage).mockResolvedValue('Plan request coverage failed: retained offline behavior (contradicted)')

    const result = await generateConfirmed({
      prompt: 'Keep offline behavior',
      settings,
    })

    expect(result).toMatchObject({ status: 'error', milestones: [] })
    expect(result.error).toContain('retained offline behavior')
    expect(ollamaAppService.generateStructured).toHaveBeenCalledTimes(2)
    expect(reviewPlanRequestCoverage).toHaveBeenCalledTimes(2)
  })

  it('reviews compiled scaffold criteria and retained verified work', async () => {
    const previous = previousPlan()
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
      complete([
        {
          ...intervention('next', 'Finish pending work'),
          sourceInterventionId: 'm-2',
        },
      ]),
    )
    await generateConfirmed({
      prompt: 'Continue',
      settings,
      previousPlan: previous,
    })

    expect(reviewPlanRequestCoverage).toHaveBeenCalledWith(
      expect.objectContaining({ model: settings.codingModel }),
      expect.objectContaining({ request: 'Continue' }),
      expect.arrayContaining([
        expect.objectContaining({
          source: 'retained',
          interventionId: 'plan-1@1:m-1',
          statement: 'Completed work: npm test',
        }),
      ]),
      [],
      ['Storage: local'],
      expect.arrayContaining([expect.objectContaining({ sourceInterventionId: 'm-2' })]),
    )
  })

  describe('workspace facts', () => {
    let workspacePath: string

    beforeEach(() => {
      workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-plan-'))
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('m-1', 'The dashboard renders', 'src/Dashboard.tsx')]))
    })

    afterEach(() => fs.rmSync(workspacePath, { recursive: true, force: true }))

    it('passes declared commands and keeps configured context', async () => {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', dev: 'vite' } }))
      await generateConfirmed({
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
      const result = await generateConfirmed({
        prompt: 'Create a React TypeScript web app',
        settings,
        workspacePath,
      })
      expect(result.milestones.flatMap((item) => item.filePaths || [])).toEqual(
        expect.arrayContaining(['package.json', 'tsconfig.json', 'index.html', 'src/main.tsx']),
      )
      const manifestStep = result.milestones.find((item) => item.filePaths?.includes('package.json'))
      expect(manifestStep?.proposedVerificationCommand).toBe('npm run build')
      expect(manifestStep).not.toHaveProperty('verificationCommand')

      fs.writeFileSync(path.join(workspacePath, 'package.json'), '{"name":"existing"}')
      const existing = await generateConfirmed({
        prompt: 'Fix app',
        settings,
        workspacePath,
      })
      expect(existing.milestones.flatMap((item) => item.filePaths || [])).not.toContain('index.html')
    })

    it('keeps scaffold and smoke checks when the empty workspace contains OnlyRag session files', async () => {
      const metadata = path.join(workspacePath, '.onlyrag', 'sessions')
      fs.mkdirSync(metadata, { recursive: true })
      fs.writeFileSync(path.join(metadata, 'history.json'), '{}')

      const result = await generateConfirmed({
        prompt: 'Create a React app',
        settings,
        workspacePath,
      })
      const files = result.milestones.flatMap((item) => item.filePaths || [])

      expect(files).toContain('index.html')
      expect(files).toContain('src/main.jsx')
      expect(files).toContain('src/App.test.jsx')
      expect(result.milestones.some((item) => item.verificationCommand === 'npm run build')).toBe(true)
      expect(result.milestones.some((item) => item.proposedVerificationCommand === 'npm test')).toBe(true)
      expect(vi.mocked(reviewPlanRequestCoverage).mock.calls[0][5]).toEqual(result.milestones)
    })

    it('regenerates a React plan that selects CRA against root entrypoints unless the user requested CRA', async () => {
      const cra = complete([
        {
          ...intervention('m-1', 'Set up a new React application using Create React App', 'package.json'),
          acceptanceCriteria: ['The app uses react-scripts and Tailwind CSS'],
        },
      ])
      const compatible = complete([intervention('m-1', 'Set up a React application with Vite', 'package.json')])
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValueOnce(cra).mockResolvedValueOnce(compatible)

      const result = await generateConfirmed({
        prompt: 'Create a React application',
        settings,
        workspacePath,
      })
      expect(result.status).toBe('success')
      expect(result.milestones.some((item) => item.title.includes('Vite'))).toBe(true)
      expect(result.milestones.some((item) => item.title.includes('Create React App'))).toBe(false)
      const correction = JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[1][0].userContent)
      expect(correction.schemaCorrection.validationError).toContain('root index.html and src/main.* entrypoints')

      vi.mocked(ollamaAppService.generateStructured).mockClear()
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(cra)
      const requested = await generateConfirmed({
        prompt: 'Use Create React App for this project',
        settings,
        workspacePath,
      })
      expect(requested.status).toBe('success')
      expect(ollamaAppService.generateStructured).toHaveBeenCalledOnce()
    })

    it('maps a command-only setup intervention to the canonical greenfield scaffold', async () => {
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(
        complete([
          {
            id: 'm-1',
            objective: 'Initialize the project',
            filePaths: [],
            acceptanceCriteria: ['The project is initialized'],
            verificationCommand: 'npx create-react-app project-dashboard-task',
          },
        ]),
      )

      const result = await generateConfirmed({
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
        const result = await generateConfirmed({
          prompt,
          settings,
          workspacePath,
        })
        const files = result.milestones.flatMap((item) => item.filePaths || [])
        expect(files).not.toContain('index.html')
        expect(files).not.toContain('src/main.tsx')
      }
    })

    it('does not re-scaffold a manifest-less workspace with existing files', async () => {
      fs.writeFileSync(path.join(workspacePath, 'app.py'), 'print("ready")')
      const result = await generateConfirmed({
        prompt: 'Create a React app',
        settings,
        workspacePath,
      })

      expect(result.milestones.flatMap((item) => item.filePaths || [])).not.toContain('index.html')
      expect(JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls.at(-1)![0].userContent).workspace).toBe('existing')
    })

    it('appends a runnable verification milestone for greenfield workspace from proposed verification commands', async () => {
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([intervention('m-1', 'Build application', 'src/App.tsx')]))

      const result = await generateConfirmed({
        prompt: 'Create a React TypeScript web app',
        settings,
        workspacePath,
      })

      expect(result.status).toBe('success')
      const verifyMilestone = result.milestones.find((item) => item.verificationCommand === 'npm run build')
      expect(verifyMilestone).toBeDefined()
      expect(verifyMilestone?.title).toContain('Verify the application')
    })
  })
})
