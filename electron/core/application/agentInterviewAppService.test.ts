import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentInterviewAppService } from './agentInterviewAppService'
import { ollamaAppService } from './ollamaAppService'
import type { AppSettings } from '../../../shared/types'

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: { generateStructured: vi.fn() },
}))

describe('AgentInterviewAppService', () => {
  let service: AgentInterviewAppService
  const settings = { codingModel: 'qwen2.5-coder:7b', ollamaHost: '' } as AppSettings

  beforeEach(() => {
    service = new AgentInterviewAppService()
    vi.clearAllMocks()
  })

  it('returns completed when the validated response has no questions', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete', content: '{"hasQuestions":false,"questions":[]}',
    })

    const result = await service.conductInterview('Crea una funzione somma', undefined, settings)

    expect(result).toMatchObject({ status: 'completed', hasQuestions: false, questions: [] })
  })

  it('falls back to alternatives stated explicitly when the model returns no questions', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete', content: '{"hasQuestions":false,"questions":[]}',
    })

    const result = await service.conductInterview(
      'Aggiungi persistenza: prima di procedere chiedimi se usare localStorage oppure file JSON.',
      undefined,
      settings
    )

    expect(result).toMatchObject({
      status: 'clarification_required',
      hasQuestions: true,
      questions: [{ options: ['localStorage', 'file JSON'], recommendedIndex: 0 }],
    })
  })

  it('parses schema-constrained questions', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete',
      content: JSON.stringify({
        hasQuestions: true,
        questions: [{ id: 'q1', question: 'Quale stile preferisci?', rationale: 'La scelta cambia compatibilità e controllo.', options: ['CSS', 'Web Animations'], recommendedIndex: 0 }],
      }),
    })

    const result = await service.conductInterview('Crea animazioni', undefined, settings)

    expect(result.status).toBe('clarification_required')
    expect(result.questions[0]).toMatchObject({ id: 'q1', recommendedIndex: 0 })
  })

  it('drops questions already answered by fresh workspace facts', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-interview-facts-'))
    fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0' }))
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete',
      content: JSON.stringify({
        hasQuestions: true,
        questions: [{ id: 'q1', question: 'Quale package manager?', rationale: 'La scelta cambia i file di lock.', options: ['npm', 'pnpm'], recommendedIndex: 1 }],
      }),
    })

    try {
      await expect(service.conductInterview('Aggiorna il progetto', undefined, settings, workspacePath)).resolves.toMatchObject({
        status: 'completed',
        hasQuestions: false,
        questions: [],
      })
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('rejects questions written in a different detectable language', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete',
      content: JSON.stringify({
        hasQuestions: true,
        questions: [{
          id: 'q1',
          question: 'Which storage do you prefer?',
          rationale: 'The choice changes the data format and portability.',
          options: ['SQLite', 'JSON'],
          recommendedIndex: 0,
        }],
      }),
    })

    const result = await service.conductInterview('Crea una pagina con filtri', undefined, settings)

    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('request language') })
  })

  it('applies context preferences and separates instructions from data', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete', content: '{"hasQuestions":false,"questions":[]}',
    })

    await service.conductInterview(
      'Crea una funzione somma',
      'qwen2.5-coder:7b',
      { ...settings, modelContextLengths: { 'qwen2.5-coder:7b': 8192 } }
    )

    const request = vi.mocked(ollamaAppService.generateStructured).mock.calls[0][0]
    expect(request.options).toEqual(expect.objectContaining({ num_ctx: 8192, num_predict: 768 }))
    expect(request.keepAlive).toBe('30m')
    expect(request.systemPrompt).not.toContain('Crea una funzione somma')
    expect(JSON.parse(request.userContent)).toMatchObject({
      request: 'Crea una funzione somma',
      projectFacts: { workspace: 'unknown', relevantFiles: [], previousDecisions: [] },
    })
    expect(request.format).toEqual(expect.objectContaining({ type: 'object' }))
  })

  it('rejects malformed or semantically invalid JSON', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete', content: '{"hasQuestions":true,',
    })
    const malformed = await service.conductInterview('Crea un gioco', undefined, settings)
    expect(malformed.error).toContain('Response is not valid JSON')

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'complete', content: '{"hasQuestions":true,"questions":[]}',
    })
    const inconsistent = await service.conductInterview('Crea un gioco', undefined, settings)
    expect(inconsistent.error).toContain('hasQuestions must match')
  })

  it('does not use transport failures or incomplete responses', async () => {
    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'transport_error', content: '', error: 'connection refused',
    })
    const failed = await service.conductInterview('Crea un gioco', undefined, settings)
    expect(failed).toMatchObject({ status: 'error' })
    expect(failed.error).toContain('connection refused')

    vi.mocked(ollamaAppService.generateStructured).mockResolvedValue({
      status: 'incomplete', content: '{"hasQuestions":false', error: 'Ollama response incomplete (length)',
    })
    const incomplete = await service.conductInterview('Crea un gioco', undefined, settings)
    expect(incomplete).toMatchObject({ status: 'error' })
    expect(incomplete.error).toContain('Ollama response incomplete (length)')
  })

  it('enriches the prompt with answer provenance', () => {
    const questions = [
      { id: 'q1', question: 'Router', rationale: 'Changes navigation.', options: ['React Router', 'Custom'], recommendedIndex: 0 },
      { id: 'q2', question: 'Theme', rationale: 'Changes presentation.', options: ['Dark', 'Light'], recommendedIndex: 0 },
    ]
    const enriched = service.enrichPromptWithAnswers('Build a dashboard', [
      { questionId: 'q1', questionText: 'Router', selectedOption: 'React Router', provenance: 'accepted_recommendation' },
      { questionId: 'q2', questionText: 'Theme', selectedOption: 'Dark', provenance: 'explicit' },
    ], questions)

    expect(enriched).toContain('[ORIGINAL USER REQUEST]\nBuild a dashboard')
    expect(enriched).toContain('[ACCEPTED RECOMMENDATION] Router: React Router')
    expect(enriched).toContain('[EXPLICIT USER ANSWER] Theme: Dark')
  })

  it('rejects answers for stale question IDs', () => {
    expect(() => service.enrichPromptWithAnswers('Build', [{
      questionId: 'old', questionText: 'Old?', selectedOption: 'A', provenance: 'explicit',
    }], [{
      id: 'current', question: 'Current?', rationale: 'Changes behavior.', options: ['A', 'B'], recommendedIndex: 0,
    }])).toThrow('Unknown or stale question ID')
  })
})
