/**
 * electron/core/application/agentInterviewAppService.ts
 *
 * Application Layer — Pre-Flight Clarification Interview Service
 *
 * Analyzes user prompts before plan generation to identify architectural,
 * styling, persistence, or library choices. Generates structured multiple-choice
 * questions with a recommended default and write-in support, validated via jsonrepair.
 */

import os from 'node:os'
import { jsonrepair } from 'jsonrepair'
import { ollamaAppService } from './ollamaAppService'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
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

const INTERVIEW_SYSTEM_PROMPT = `You are an expert AI Software Architect. Your job is to analyze the user's coding request before formulating an implementation plan.

Evaluate whether the request has significant architectural, technological, styling, or library choices that would genuinely benefit from the user's explicit preference (for example: CSS framework vs Vanilla CSS, state management/persistence strategy, single-file HTML vs modular SPA structure).

If the request is already clear, well-scoped, or has obvious standard choices, respond with:
{"hasQuestions": false, "questions": []}

If there are 1-2 genuine technical trade-offs to clarify, output a valid JSON block with this exact schema:
{
  "hasQuestions": true,
  "questions": [
    {
      "id": "q1",
      "question": "Concise description of the technical choice",
      "options": [
        "Recommended option",
        "Alternative option 1",
        "Alternative option 2"
      ],
      "recommendedIndex": 0
    }
  ]
}

STRICT RULES:
1. At most 1-2 questions, each with 2-3 clear and concrete options.
2. The option at index 0 (recommendedIndex: 0) MUST be the best standard, self-sufficient default choice.
3. NEVER ask trivial confirmation questions (e.g. "do you want to proceed?"). Only ask about real technical architectural trade-offs.
4. CRITICAL LANGUAGE DIRECTIVE: The question and options text MUST be written in the EXACT same language used by the user in their prompt (e.g. Italian if prompt is in Italian, English if English, French if French, Spanish if Spanish, German if German, etc.).
5. Respond EXCLUSIVELY with the valid JSON block.`

export class AgentInterviewAppService {
  async conductInterview(
    prompt: string,
    model: string | undefined,
    settings: AppSettings
  ): Promise<InterviewAnalysisResult> {
    const modelToUse = model || settings.codingModel || settings.defaultModel || 'qwen2.5-coder:7b'
    const cachedGpu = getCachedGpuInfo()
    const memInfo = getMemoryInfo()
    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(settings.hardwareProfile, {
      hasGpu: cachedGpu?.hasNvidiaGpu,
      vramTotalMB: cachedGpu?.vramTotalMB,
      systemRamGB: memInfo?.totalRAMGB,
      cpuCount: os.cpus()?.length,
      enableSystemRamOffloading: settings.enableSystemRamOffloading,
    })

    const fullPrompt = `${INTERVIEW_SYSTEM_PROMPT}\n\nUser request to analyze:\n\n${prompt}`

    let accumulated = ''
    try {
      const res = await ollamaAppService.generateStream(
        modelToUse,
        fullPrompt,
        (chunk: string) => {
          accumulated += chunk
        },
        () => {},
        runtimeOpts
      )

      if (!res.success) {
        logger.log('WARN', 'AgentInterviewAppService', `Interview generation failed: ${res.error}`)
        return { hasQuestions: false, questions: [] }
      }

      const repaired = this.extractAndRepairJson(accumulated)
      if (!repaired) {
        logger.log('WARN', 'AgentInterviewAppService', `Could not extract or repair valid JSON from model output: ${accumulated}`)
        return { hasQuestions: false, questions: [] }
      }

      const parsed = JSON.parse(repaired)
      if (typeof parsed !== 'object' || parsed === null) {
        return { hasQuestions: false, questions: [] }
      }

      if (!parsed.hasQuestions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        return { hasQuestions: false, questions: [] }
      }

      const validatedQuestions: InterviewQuestion[] = []
      for (const q of parsed.questions) {
        if (
          typeof q.id === 'string' &&
          typeof q.question === 'string' &&
          Array.isArray(q.options) &&
          q.options.length >= 2
        ) {
          const recIdx = typeof q.recommendedIndex === 'number' && q.recommendedIndex >= 0 && q.recommendedIndex < q.options.length
            ? q.recommendedIndex
            : 0
          validatedQuestions.push({
            id: q.id,
            question: q.question,
            options: q.options.map(String),
            recommendedIndex: recIdx,
          })
        }
      }

      return {
        hasQuestions: validatedQuestions.length > 0,
        questions: validatedQuestions,
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
      .map((a) => `- ${a.questionText}: ${a.selectedOption}${a.isCustom ? ' (Custom)' : ''}`)
      .join('\n')

    return (
      `${originalPrompt.trim()}\n\n` +
      `[CONFIRMED USER ARCHITECTURAL DECISIONS]\n` +
      `${formattedChoices}`
    )
  }
}

export const agentInterviewAppService = new AgentInterviewAppService()
