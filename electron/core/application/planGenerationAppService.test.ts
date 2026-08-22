import { describe, it, expect, vi, beforeEach } from 'vitest'
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
})
