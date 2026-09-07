import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentInterviewAppService } from './agentInterviewAppService'
import { ollamaAppService } from './ollamaAppService'
import type { AppSettings } from '../../../shared/types'

vi.mock('./ollamaAppService', () => ({
  ollamaAppService: {
    generateStream: vi.fn(),
  },
}))

describe('AgentInterviewAppService', () => {
  let service: AgentInterviewAppService
  const mockSettings: AppSettings = {
    codingModel: 'qwen2.5-coder:7b',
  } as any

  beforeEach(() => {
    service = new AgentInterviewAppService()
    vi.mocked(ollamaAppService.generateStream).mockReset()
    vi.clearAllMocks()
  })

  it('returns hasQuestions: false when LLM responds with no questions', async () => {
    vi.mocked(ollamaAppService.generateStream).mockImplementation(
      async (_model, _prompt, onChunk) => {
        onChunk('{"hasQuestions": false, "questions": []}')
        return { success: true }
      }
    )

    const result = await service.conductInterview('Crea una funzione somma', 'qwen2.5-coder:7b', mockSettings)
    expect(result.status).toBe('completed')
    expect(result.hasQuestions).toBe(false)
    expect(result.questions).toHaveLength(0)
  })

  it('applies the selected coding model context preference to the pre-flight interview', async () => {
    vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: true })

    await service.conductInterview(
      'Crea una funzione somma',
      'qwen2.5-coder:7b',
      { ...mockSettings, modelContextLengths: { 'qwen2.5-coder:7b': 8192 } }
    )

    expect(vi.mocked(ollamaAppService.generateStream).mock.calls[0][4]).toEqual(
      expect.objectContaining({ num_ctx: 8192 })
    )
  })

  it('parses and repairs structured multiple choice questions from markdown json block', async () => {
    const rawResponse = `Ecco le scelte:\n\`\`\`json\n{\n  "hasQuestions": true,\n  "questions": [\n    {\n      "id": "q1",\n      "question": "Quale stile di animazione preferisci?",\n      "options": ["CSS Keyframes", "Web Animations API", "Tailwind CSS"],\n      "recommendedIndex": 0\n    }\n  ]\n}\n\`\`\``
    
    vi.mocked(ollamaAppService.generateStream).mockImplementation(
      async (_model, _prompt, onChunk) => {
        onChunk(rawResponse)
        return { success: true }
      }
    )

    const result = await service.conductInterview('Crea una landing page con animazioni', 'qwen2.5-coder:7b', mockSettings)
    expect(result.hasQuestions).toBe(true)
    expect(result.status).toBe('clarification_required')
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0].question).toBe('Quale stile di animazione preferisci?')
    expect(result.questions[0].options).toEqual(['CSS Keyframes', 'Web Animations API', 'Tailwind CSS'])
    expect(result.questions[0].recommendedIndex).toBe(0)
  })

  it('repairs malformed JSON (trailing commas, unescaped quotes) via jsonrepair', async () => {
    const malformed = `{"hasQuestions": true, "questions": [{"id": "q1", "question": "Framework?", "options": ["Vanilla JS", "React",], "recommendedIndex": 0,},],}`
    
    vi.mocked(ollamaAppService.generateStream).mockImplementation(
      async (_model, _prompt, onChunk) => {
        onChunk(malformed)
        return { success: true }
      }
    )

    const result = await service.conductInterview('Crea un gioco', 'qwen2.5-coder:7b', mockSettings)
    expect(result.hasQuestions).toBe(true)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0].options).toEqual(['Vanilla JS', 'React'])
  })

  it('reports transport failure as an error rather than as a successful no-question analysis', async () => {
    vi.mocked(ollamaAppService.generateStream).mockResolvedValue({ success: false, error: 'connection refused' })

    const result = await service.conductInterview('Crea un gioco', 'qwen2.5-coder:7b', mockSettings)

    expect(result).toMatchObject({
      status: 'error',
      hasQuestions: false,
      questions: [],
      error: 'connection refused',
    })
  })

  it('reports invalid JSON as an error rather than continuing to generic planning', async () => {
    vi.mocked(ollamaAppService.generateStream).mockImplementation(async (_model, _prompt, onChunk) => {
      onChunk('not a structured interview response')
      return { success: true }
    })

    const result = await service.conductInterview('Crea un gioco', 'qwen2.5-coder:7b', mockSettings)

    expect(result.status).toBe('error')
    expect(result.error).toBe('Interview response is not an object')
  })

  it('rejects an invalid result shape instead of interpreting it as no questions', async () => {
    vi.mocked(ollamaAppService.generateStream).mockImplementation(async (_model, _prompt, onChunk) => {
      onChunk('{"hasQuestions": true, "questions": []}')
      return { success: true }
    })

    const result = await service.conductInterview('Crea un gioco', 'qwen2.5-coder:7b', mockSettings)

    expect(result.status).toBe('error')
    expect(result.error).toBe('Interview response does not match the required result shape')
  })

  it('enriches prompt correctly with user confirmed answers', () => {
    const original = 'Crea una calcolatrice moderna'
    const answers = [
      {
        questionId: 'q1',
        questionText: 'Layout UI',
        selectedOption: 'Grid moderna con CSS Grid',
        isCustom: false,
      },
      {
        questionId: 'q2',
        questionText: 'Gestione Cronologia',
        selectedOption: 'Salva in localStorage',
        isCustom: true,
      },
    ]

    const enriched = service.enrichPromptWithAnswers(original, answers)
    expect(enriched).toContain('Crea una calcolatrice moderna')
    expect(enriched).toContain('[ORIGINAL USER REQUEST]\nCrea una calcolatrice moderna')
    expect(enriched).toContain('[INTERVIEW DECISIONS]')
    expect(enriched).toContain('- [EXPLICIT USER ANSWER] Layout UI: Grid moderna con CSS Grid')
    expect(enriched).toContain('- [EXPLICIT USER ANSWER] Gestione Cronologia: Salva in localStorage (Custom)')
  })

  it('keeps accepted recommendations and unconfirmed assumptions distinct from explicit answers', () => {
    const enriched = service.enrichPromptWithAnswers('Build a dashboard', [
      { questionId: 'q1', questionText: 'Router', selectedOption: 'React Router', provenance: 'accepted_recommendation' },
      { questionId: 'q2', questionText: 'Theme', selectedOption: 'Dark', provenance: 'explicit' },
      { questionId: 'q3', questionText: 'Storage', selectedOption: 'Local only', provenance: 'unconfirmed_assumption' },
    ])

    expect(enriched).toContain('[ACCEPTED RECOMMENDATION] Router: React Router')
    expect(enriched).toContain('[EXPLICIT USER ANSWER] Theme: Dark')
    expect(enriched).toContain('[UNCONFIRMED ASSUMPTION] Storage: Local only')
  })
})
