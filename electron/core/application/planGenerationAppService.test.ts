import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planGenerationAppService } from './planGenerationAppService'
import { ollamaAppService } from './ollamaAppService'
import { extractDeliverablePaths } from '../../../shared/domain/agent/milestoneDeliverableResolver'
import { isFalsifiableMilestone } from '../../../shared/domain/agent/planFalsifiabilityNormalizer'
import type { AppSettings } from '../../../shared/types'

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: { generateStructured: vi.fn() },
}))

const settings: AppSettings = {
  defaultModel: 'llama3.2',
  codingModel: 'qwen2.5-coder:7b',
  ollamaHost: '',
} as AppSettings

function complete(milestones: Array<{
  id: string
  objective: string
  filePath?: string
  verificationCommand?: string
}>) {
  return { status: 'complete' as const, content: JSON.stringify({ milestones }) }
}

describe('PlanGenerationAppService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses structured generation and derives canonical Markdown', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { id: 'm-1', objective: 'The schema accepts credentials', filePath: 'src/schema.ts' },
      { id: 'm-2', objective: 'The endpoint logs users in', filePath: 'src/auth.ts' },
    ]))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Add login', settings })

    expect(result.status).toBe('success')
    expect(result.planText).toContain('- [ ] m-1: The schema accepts credentials — `src/schema.ts`')
    expect(result.milestones).toHaveLength(2)
    const request = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    expect(request.model).toBe('qwen2.5-coder:7b')
    expect(request.systemPrompt).not.toContain('Add login')
    expect(JSON.parse(request.userContent).request).toBe('Add login')
    expect(request.format).toEqual(expect.objectContaining({ type: 'object' }))
  })

  it('passes pending residue as data without mixing it into instructions', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { id: 'm-1', objective: 'Password hashing works', filePath: 'src/auth.ts' },
    ]))

    await planGenerationAppService.generatePlanText({
      prompt: 'Continue auth',
      settings,
      pendingResidueMilestones: [{ id: 'm-7', title: 'Add password hashing', status: 'in_progress' }],
    })

    const request = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    const data = JSON.parse(request.userContent)
    expect(data.pendingMilestones).toEqual([{ id: 'm-7', title: 'Add password hashing', status: 'in_progress' }])
    expect(request.systemPrompt).not.toContain('Add password hashing')
  })

  it('keeps transport, incomplete, and schema failures non-executable', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValueOnce({
      status: 'transport_error', content: '', error: 'connection refused',
    })
    expect(await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })).toEqual({
      status: 'error', planText: '', milestones: [], error: 'connection refused',
    })

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValueOnce({
      status: 'incomplete', content: '{"milestones":[', error: 'Ollama response incomplete (length)',
    })
    const incomplete = await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })
    expect(incomplete).toMatchObject({ status: 'error', milestones: [], error: 'Ollama response incomplete (length)' })

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValueOnce({
      status: 'complete', content: '{"milestones":[]}',
    })
    const invalid = await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })
    expect(invalid.status).toBe('error')
    expect(invalid.milestones).toEqual([])
    expect(invalid.error).toContain('Invalid plan response')
  })

  it('keeps schema validity distinct from verification correctness', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { id: 'm-1', objective: 'The build passes', verificationCommand: 'npm run invented' },
    ]))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Task', settings })

    expect(result).toMatchObject({ status: 'error', milestones: [] })
    expect(result.error).toContain('unavailable verification command')
  })

  it('uses explicit model and configured context length', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { id: 'm-1', objective: 'Task works', filePath: 'src/task.ts' },
    ]))

    await planGenerationAppService.generatePlanText({
      prompt: 'Task',
      model: 'llama3.1:8b',
      settings: { ...settings, modelContextLengths: { 'llama3.1:8b': 8192 } },
    })

    const request = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    expect(request.model).toBe('llama3.1:8b')
    expect(request.options).toEqual(expect.objectContaining({ num_ctx: 8192 }))
  })

  it('re-parses user-edited Markdown through the canonical compiler', () => {
    const milestones = planGenerationAppService.parsePlanText('1. First step\n2. Second step')
    expect(milestones.map((milestone) => milestone.title)).toEqual(['First step', 'Second step'])
  })

  describe('workspace facts and verification commands', () => {
    let workspacePath: string

    beforeEach(() => {
      workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-plan-'))
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
        { id: 'm-1', objective: 'The dashboard renders', filePath: 'src/Dashboard.tsx' },
      ]))
    })

    afterEach(() => fs.rmSync(workspacePath, { recursive: true, force: true }))

    const requestData = () => JSON.parse(vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0].userContent)

    it('passes only commands declared by the project', async () => {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({
        scripts: { build: 'vite build', test: 'vitest run', dev: 'vite' },
      }))

      await planGenerationAppService.generatePlanText({ prompt: 'Add dashboard', settings, workspacePath })

      expect(requestData().workspace).toBe('existing')
      expect(requestData().allowedVerificationCommands).toEqual(expect.arrayContaining(['npm run build', 'npm run test']))
      expect(requestData().allowedVerificationCommands).not.toContain('npm run dev')
    })

    it('passes an empty command list for an empty workspace', async () => {
      await planGenerationAppService.generatePlanText({ prompt: 'Create app', settings, workspacePath })

      expect(requestData()).toMatchObject({ workspace: 'empty', allowedVerificationCommands: [] })
    })

    it('keeps a declared verification command through compilation', async () => {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
        { id: 'm-1', objective: 'The page renders', filePath: 'src/App.tsx' },
        { id: 'm-2', objective: 'The project builds', verificationCommand: 'npm run build' },
      ]))

      const result = await planGenerationAppService.generatePlanText({ prompt: 'Add page', settings, workspacePath })

      expect(result.milestones[1]).toMatchObject({ title: 'The project builds', verificationCommand: 'npm run build' })
      expect(planGenerationAppService.parsePlanText(result.planText, workspacePath)).toEqual(result.milestones)
    })

    it('does not inject greenfield scaffolding into an existing project', async () => {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), '{"name":"existing"}')

      const result = await planGenerationAppService.generatePlanText({ prompt: 'Fix dashboard', settings, workspacePath })

      expect(result.milestones.map((milestone) => milestone.title).join('\n')).not.toMatch(/package\.json|index\.html/)
    })
  })

  it('keeps capability and deliverable evidence together', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
      { id: 'm-1', objective: 'The user can finish a task', filePath: 'src/TasksPage.tsx' },
    ]))

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Task app', settings })

    expect(extractDeliverablePaths(result.milestones[0].title)).toEqual(['src/TasksPage.tsx'])
    expect(result.milestones.every(isFalsifiableMilestone)).toBe(true)
  })

  it('round-trips compiler-added entry requirements for an empty web workspace', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-greenfield-'))
    try {
      vi.mocked(ollamaAppService.generateStructured).mockResolvedValue(complete([
        { id: 'm-1', objective: 'The app renders', filePath: 'src/App.tsx' },
      ]))

      const generated = await planGenerationAppService.generatePlanText({ prompt: 'Create app', settings, workspacePath })
      const reparsed = planGenerationAppService.parsePlanText(generated.planText, workspacePath)

      const identity = (milestones: typeof generated.milestones) => milestones.map(({ id, title, status, verificationCommand }) => ({
        id, title, status, verificationCommand,
      }))
      expect(identity(reparsed)).toEqual(identity(generated.milestones))
      expect(generated.milestones.map((milestone) => milestone.title).join('\n')).toMatch(/package\.json/)
      expect(generated.milestones.map((milestone) => milestone.title).join('\n')).toMatch(/src\/main\.tsx/)
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })
})
