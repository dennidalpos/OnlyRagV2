import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { planGenerationAppService } from './planGenerationAppService'
import { ollamaAppService } from './ollamaAppService'
import type { AppSettings } from '../../../src/types'

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: {
    generateStream: vi.fn(),
  },
}))

describe('PlanGenerationAppService', () => {
  const settings: AppSettings = {
    defaultModel: 'llama3.2',
    hardwareProfile: 'Medium',
    ocrEngine: 'native_cuda',
    ollamaHost: '',
    codingModel: 'qwen2.5-coder:7b',
    translationModel: 'llama3.2',
    visionModel: 'llama3.2-vision',
    embeddingModel: 'nomic-embed-text',
    allowTerminalExecution: true,
    allowFileModifications: true,
    customPromptOverrides: {},
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should route generation through hardware-profile runtime options and parse milestones from the response', async () => {
    vi.mocked(ollamaAppService.generateStream).mockImplementation(async (_model, _prompt, onChunk) => {
      onChunk('- [ ] Design the schema\n- [ ] Implement the endpoint\n')
      return { success: true }
    })

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Add a login endpoint', settings })

    expect(ollamaAppService.generateStream).toHaveBeenCalledWith(
      'qwen2.5-coder:7b',
      expect.stringContaining('Add a login endpoint'),
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ num_ctx: expect.any(Number), temperature: expect.any(Number) })
    )
    expect(result.planText).toContain('Design the schema')
    expect(result.milestones).toHaveLength(2)
    expect(result.milestones[0].title).toBe('Design the schema')
    expect(result.milestones[0].status).toBe('pending')
  })

  it('should fold pending residue milestones into the prompt as reconciliation context (C7)', async () => {
    vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: true })

    await planGenerationAppService.generatePlanText({
      prompt: 'Continue the auth work',
      settings,
      pendingResidueMilestones: [
        { id: 'm-1', title: 'Add password hashing', status: 'pending' },
        { id: 'm-2', title: 'Wire up login route', status: 'in_progress' },
      ],
    })

    expect(ollamaAppService.generateStream).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('CONTESTO DI RICONCILIAZIONE'),
      expect.any(Function),
      expect.any(Function),
      expect.any(Object)
    )
    const [, promptArg] = vi.mocked(ollamaAppService.generateStream).mock.calls[0]
    expect(promptArg).toContain('Add password hashing')
    expect(promptArg).toContain('Wire up login route')
  })

  it('should NOT include a reconciliation block when there is no pending residue', async () => {
    vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: true })

    await planGenerationAppService.generatePlanText({ prompt: 'Fresh task', settings })

    const [, promptArg] = vi.mocked(ollamaAppService.generateStream).mock.calls[0]
    expect(promptArg).not.toContain('CONTESTO DI RICONCILIAZIONE')
  })

  it('should fall back to a generic plan when the sidecar/Ollama call fails or returns nothing', async () => {
    vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: false, error: 'connection refused' })

    const result = await planGenerationAppService.generatePlanText({ prompt: 'Refactor the auth module', settings })

    expect(result.planText).toContain('Refactor the auth module')
    expect(result.milestones.length).toBeGreaterThanOrEqual(2)
  })

  it('should use the explicit model override when provided instead of settings.codingModel', async () => {
    vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: true })

    await planGenerationAppService.generatePlanText({ prompt: 'Task', model: 'llama3.1:8b', settings })

    expect(ollamaAppService.generateStream).toHaveBeenCalledWith(
      'llama3.1:8b',
      expect.any(String),
      expect.any(Function),
      expect.any(Function),
      expect.any(Object)
    )
  })

  it('parsePlanText should re-parse arbitrary plan text through the same canonical parser', () => {
    const milestones = planGenerationAppService.parsePlanText('1. First step\n2. Second step\n3. Third step')
    expect(milestones).toHaveLength(3)
    expect(milestones[0].title).toBe('First step')
  })
  describe('project-resolved verification commands', () => {
    let workspacePath: string

    beforeEach(() => {
      workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-plan-verify-'))
      vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: true })
    })

    afterEach(() => {
      try {
        fs.rmSync(workspacePath, { recursive: true, force: true })
      } catch {}
    })

    const capturedPrompt = () => vi.mocked(ollamaAppService.generateStream).mock.calls[0][1] as string

    it('offers the planner only the commands the workspace manifest actually declares', async () => {
      fs.writeFileSync(
        path.join(workspacePath, 'package.json'),
        JSON.stringify({ scripts: { build: 'vite build', dev: 'vite', test: 'vitest run' } })
      )

      await planGenerationAppService.generatePlanText({ prompt: 'Add a dashboard', settings, workspacePath })

      const prompt = capturedPrompt()
      expect(prompt).toContain('`npm run build`')
      expect(prompt).toContain('`npm run test`')
      // `dev` never exits, so proposing it as a proof would hang the verification forever.
      expect(prompt).not.toContain('`npm run dev`')
      expect(prompt).toContain('FORBIDDEN from inventing')
    })

    it('tells the planner no command exists rather than letting it invent one', async () => {
      await planGenerationAppService.generatePlanText({ prompt: 'Scaffold a new app', settings, workspacePath })

      const prompt = capturedPrompt()
      expect(prompt).toContain('VERIFICATION COMMANDS AVAILABLE IN THIS PROJECT: NONE.')
      expect(prompt).toContain('DO NOT EXIST here until a microtask creates them')
    })

    it('keeps the verification command the planner declares on a checklist line', async () => {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
      vi.mocked(ollamaAppService.generateStream).mockImplementation(async (_model, _prompt, onChunk) => {
        onChunk('- [ ] m-1: Create `src/App.tsx` shell\n- [ ] m-2: Build pulita — verify: `npm run build`\n')
        return { success: true }
      })

      const result = await planGenerationAppService.generatePlanText({ prompt: 'Add a page', settings, workspacePath })

      expect(result.milestones[1].title).toBe('Build pulita')
      expect(result.milestones[1].verificationCommand).toBe('npm run build')
    })
  })
})
