/**
 * electron/core/application/agentInterviewAppService.ts
 *
 * Application Layer — Pre-Flight Clarification Interview Service (Claude Code style)
 *
 * Analyzes user prompts before plan generation to identify architectural,
 * styling, persistence, or library choices. Generates structured multiple-choice
 * questions with a recommended default and write-in support, validated via jsonrepair.
 */

import { jsonrepair } from 'jsonrepair'
import { ollamaAppService } from './ollamaAppService'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { logger } from '../../diagnostics'
import type { AppSettings } from '../../../src/types'

export interface InterviewQuestion {
  id: string
  question: string
  options: string[]
  recommendedIndex: number
}

export interface InterviewAnalysisResult {
  hasQuestions: boolean
  questions: InterviewQuestion[]
  rawResponse?: string
}

export interface UserInterviewAnswer {
  questionId: string
  questionText: string
  selectedOption: string
  isCustom?: boolean
}

const INTERVIEW_SYSTEM_PROMPT = `Sei un AI Software Architect esperto. Il tuo compito è analizzare la richiesta dell'utente prima di generare il piano di sviluppo.

Valuta se la richiesta presenta scelte architetturali, tecnologiche, di layout o di librerie che beneficerebbero di una decisione esplicita dell'utente (ad esempio: framework CSS/Vanilla, gestione dello stato/persistenza, stile di layout, singolo file HTML vs modulare).

Se la richiesta è già completamente specificata o non presenta dubbi tecnici rilevanti, rispondi con:
{"hasQuestions": false, "questions": []}

Se ci sono 1-2 scelte tecniche chiave da chiarire, genera un JSON valido con questo schema esatto:
{
  "hasQuestions": true,
  "questions": [
    {
      "id": "q1",
      "question": "Descrizione sintetica della scelta tecnica",
      "options": [
        "Opzione consigliata",
        "Opzione alternativa 1",
        "Opzione alternativa 2"
      ],
      "recommendedIndex": 0
    }
  ]
}

REGOLE TASSATIVE:
1. Massimo 1-2 domande, ciascuna con 2-3 opzioni chiare e concrete.
2. L'opzione all'indice 0 (recommendedIndex: 0) deve essere la scelta tecnica standard migliore e autosufficiente.
3. NON fare domande banali (es. "vuoi procedere?"). Fai solo domande su trade-off tecnici effettivi.
4. Rispondi ESCLUSIVAMENTE con il blocco JSON.`

export class AgentInterviewAppService {
  async conductInterview(
    prompt: string,
    model: string | undefined,
    settings: AppSettings
  ): Promise<InterviewAnalysisResult> {
    const modelToUse = model || settings.codingModel || settings.defaultModel || 'qwen2.5-coder:7b'
    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(settings.hardwareProfile)

    const fullPrompt = `${INTERVIEW_SYSTEM_PROMPT}\n\nAnalizza la seguente richiesta dell'utente:\n\n${prompt}`

    let accumulated = ''
    try {
      const res = await ollamaAppService.generateStream(
        modelToUse,
        fullPrompt,
        (chunk) => {
          accumulated += chunk
        },
        () => {},
        { num_ctx: runtimeOpts.num_ctx, temperature: 0.1 }
      )

      if (!res.success) {
        logger.log('WARN', 'AgentInterviewAppService', `Interview generation failed: ${res.error}`)
        return { hasQuestions: false, questions: [] }
      }
    } catch (err: any) {
      logger.log('WARN', 'AgentInterviewAppService', `Interview generation threw: ${err.message}`)
      return { hasQuestions: false, questions: [] }
    }

    try {
      const cleanedJson = this.extractAndRepairJson(accumulated)
      if (!cleanedJson) {
        return { hasQuestions: false, questions: [] }
      }

      const parsed = JSON.parse(cleanedJson)
      if (!parsed || typeof parsed !== 'object') {
        return { hasQuestions: false, questions: [] }
      }

      const hasQuestions = Boolean(parsed.hasQuestions && Array.isArray(parsed.questions) && parsed.questions.length > 0)
      if (!hasQuestions) {
        return { hasQuestions: false, questions: [] }
      }

      const questions: InterviewQuestion[] = parsed.questions
        .filter((q: any) => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length >= 2)
        .slice(0, 2)
        .map((q: any, idx: number) => ({
          id: q.id || `q_${idx + 1}`,
          question: q.question.trim(),
          options: q.options.map((opt: any) => String(opt).trim()).filter(Boolean),
          recommendedIndex: typeof q.recommendedIndex === 'number' && q.recommendedIndex >= 0 && q.recommendedIndex < q.options.length ? q.recommendedIndex : 0,
        }))

      return {
        hasQuestions: questions.length > 0,
        questions,
        rawResponse: accumulated,
      }
    } catch (parseErr: any) {
      logger.log('WARN', 'AgentInterviewAppService', `Failed to parse interview response: ${parseErr.message}`)
      return { hasQuestions: false, questions: [] }
    }
  }

  /**
   * Extracts JSON block and repairs syntax errors using jsonrepair.
   */
  private extractAndRepairJson(rawText: string): string | null {
    if (!rawText) return null
    let candidate = rawText.trim()

    // Strip markdown code fences if present
    const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenceMatch) {
      candidate = fenceMatch[1].trim()
    } else {
      const firstBrace = candidate.indexOf('{')
      const lastBrace = candidate.lastIndexOf('}')
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidate = candidate.slice(firstBrace, lastBrace + 1)
      }
    }

    try {
      return jsonrepair(candidate)
    } catch {
      return null
    }
  }

  /**
   * Enriches the original user prompt with the confirmed interview answers.
   */
  enrichPromptWithAnswers(originalPrompt: string, answers: UserInterviewAnswer[]): string {
    if (!answers || answers.length === 0) return originalPrompt

    const formattedChoices = answers
      .map((a) => `- ${a.questionText}: ${a.selectedOption}${a.isCustom ? ' (Personalizzato)' : ''}`)
      .join('\n')

    return (
      `${originalPrompt.trim()}\n\n` +
      `[DECISIONI ARCHITETTURALI CONFERMATE DALL'UTENTE]\n` +
      `${formattedChoices}`
    )
  }
}

export const agentInterviewAppService = new AgentInterviewAppService()
