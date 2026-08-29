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
    expect(enriched).toContain('[CONFIRMED USER ARCHITECTURAL DECISIONS]')
    expect(enriched).toContain('- Layout UI: Grid moderna con CSS Grid')
    expect(enriched).toContain('- Gestione Cronologia: Salva in localStorage (Custom)')
  })
})
