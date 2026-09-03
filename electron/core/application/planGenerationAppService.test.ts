import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { planGenerationAppService } from './planGenerationAppService'
import { ollamaAppService } from './ollamaAppService'
import { extractDeliverablePaths } from '../../../shared/domain/agent/milestoneDeliverableResolver'
import { isFalsifiableMilestone } from '../../../shared/domain/agent/planFalsifiabilityNormalizer'
import { isCompletionMilestoneTitle } from '../../../shared/domain/agent/planAndSolveGraph'
import type { AppSettings } from '../../../shared/types'

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: {
    generateStream: vi.fn(),
  },
}))

describe('PlanGenerationAppService', () => {
  const settings: AppSettings = {
    defaultModel: 'llama3.2',
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

  it('applies the selected coding model context preference to planning', async () => {
    vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: true })

    await planGenerationAppService.generatePlanText({
      prompt: 'Task',
      settings: { ...settings, modelContextLengths: { 'qwen2.5-coder:7b': 8192 } },
    })

    expect(vi.mocked(ollamaAppService.generateStream).mock.calls[0][4]).toEqual(
      expect.objectContaining({ num_ctx: 8192 })
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

    it('does not add greenfield scaffolding milestones to an existing project plan', async () => {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ name: 'existing-app' }))

      const result = await planGenerationAppService.generatePlanText({ prompt: 'Fix the dashboard', settings, workspacePath })

      expect(result.milestones.map((milestone) => milestone.title).join('\n')).not.toMatch(/package\.json|index\.html|src\/main\.tsx/)
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

  /**
   * The shape rule of blueprint §1.5: a plan whose milestones only name files reaches 100% on a
   * dead application. These lock the two halves that make the new shape safe — the capability
   * is stated, and the path is still there for the deliverable probe to check.
   */
  describe('capability-shaped microtasks', () => {
    const capturedPrompt = () => vi.mocked(ollamaAppService.generateStream).mock.calls[0][1] as string

    it('asks the planner for what works, not for the file to create', async () => {
      vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: true })

      await planGenerationAppService.generatePlanText({ prompt: 'Crea una dashboard', settings })

      const prompt = capturedPrompt()
      expect(prompt).toContain('EVERY MICRO-TASK STATES WHAT WORKS, THEN NAMES THE FILE THAT MAKES IT WORK')
      expect(prompt).toContain('The Tasks page lists the tasks and marks one complete — `src/pages/TasksPage.tsx`')
      expect(prompt).toContain('DO NOT WRITE: "- [ ] m-7: Create `src/pages/TasksPage.tsx`"')
      // The entrypoint phase exists because a page that loads no script compiles to nothing
      // (blueprint §5.6f): 14/15 milestones verified, zero JavaScript emitted.
      expect(prompt).toContain('Phase B — Wiring')
      // An inspection step names nothing on disk, so the normalizer folds it away: asking for
      // one would spend a milestone the plan never gets back.
      expect(prompt).toContain('Never write a microtask for reading, inspecting or analysing the workspace')
    })

    it('keeps the greenfield skeleton an imperative, not a cross-reference', async () => {
      // Measured regression, 2026-08-25: the first live run with the rewritten prompt produced a
      // plan that began at `src/` and never named index.html, main.tsx, vite.config.ts or
      // tsconfig.json. Fifty steps, twenty-four writes, zero builds, no entrypoint on disk. The
      // rewrite had turned "the first microtasks MUST establish the buildable project skeleton"
      // into "start at phase A", and the model followed the format but not the pointer.
      vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: true })

      await planGenerationAppService.generatePlanText({ prompt: 'Crea una dashboard da zero', settings })

      const prompt = capturedPrompt()
      expect(prompt).toContain('the FIRST microtasks MUST establish the buildable project skeleton')
      for (const file of ['`package.json`', '`index.html`', '`vite.config.ts`', '`tsconfig.json`', '`src/main.tsx`', '`src/App.tsx`']) {
        expect(prompt).toContain(file)
      }
    })

    it('keeps the deliverable checkable when the title leads with the capability', async () => {
      vi.mocked(ollamaAppService.generateStream).mockImplementation(async (_model, _prompt, onChunk) => {
        onChunk(
          '- [ ] m-1: La pagina carica lo script di ingresso — `index.html`\n' +
            '- [ ] m-2: The user can mark a task finished — `src/pages/TasksPage.tsx`\n'
        )
        return { success: true }
      })

      const result = await planGenerationAppService.generatePlanText({ prompt: 'Task app', settings })

      expect(result.milestones).toHaveLength(2)
      expect(extractDeliverablePaths(result.milestones[0].title)).toEqual(['index.html'])
      expect(extractDeliverablePaths(result.milestones[1].title)).toEqual(['src/pages/TasksPage.tsx'])
      expect(result.milestones.every(isFalsifiableMilestone)).toBe(true)
      // "finished" in a capability clause is not the closing milestone: reading it as one would
      // hand the work to the finish tool and hide it from getActiveMilestone.
      expect(isCompletionMilestoneTitle(result.milestones[1].title)).toBe(false)
    })

    it('ships a fallback plan in the shape it asks the planner for', async () => {
      vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: false, error: 'offline' })

      const result = await planGenerationAppService.generatePlanText({ prompt: 'Crea una todo app', settings })

      const operational = result.milestones.filter((m) => !isCompletionMilestoneTitle(m.title))
      expect(operational.length).toBeGreaterThan(0)
      for (const milestone of operational) {
        // Every operational entry names a real file, so none of them is unprovable, and none
        // names a bare directory — the shape that cost seven steps in the run of §5.4.
        const deliverables = extractDeliverablePaths(milestone.title)
        expect(deliverables.length).toBeGreaterThan(0)
        expect(deliverables.some((d) => d.endsWith('/'))).toBe(false)
      }
      // No workspace was given, so no command could be resolved: the fallback must not invent one.
      expect(result.milestones.every((m) => !m.verificationCommand)).toBe(true)
      expect(result.planText).not.toContain('npm run build')
    })
  })
})
