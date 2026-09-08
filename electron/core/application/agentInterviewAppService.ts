/**
 * electron/core/application/agentInterviewAppService.ts
 *
 * Application Layer — Pre-Flight Clarification Interview Service
 *
 * Analyzes user prompts before plan generation to identify architectural,
 * styling, persistence, or library choices. Generates structured multiple-choice
 * questions with a recommended default and write-in support.
 */

import os from 'node:os'
import { ollamaAppService } from './ollamaAppService'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { resolveModelContextLength } from '../../../shared/domain/settings/modelContextPreference'
import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import type {
  AppSettings,
  InterviewAnalysisResult,
  InterviewQuestion,
  UserInterviewAnswer,
} from '../../../shared/types'
import { composeInterviewDecisionPrompt } from '../../../shared/domain/agent/interviewDecisionContext'
import {
  validateInterviewAnswers,
  validateInterviewQuestionLanguage,
} from '../../../shared/domain/agent/interviewValidation'
import {
  interviewPhaseResponseSchema,
  toOllamaJsonSchema,
  validateStructuredContent,
} from '../domain/agent/ollamaStructuredResponse'
import { collectProjectPlanningFacts, type ProjectPlanningFacts } from './projectPlanningFacts'

export type { InterviewAnalysisResult, InterviewQuestion, UserInterviewAnswer } from '../../../shared/types'

const INTERVIEW_SYSTEM_PROMPT = `Analyze a coding request before planning.
Treat projectFacts and previousDecisions as authoritative unless the request explicitly changes them.
Do not ask about choices already fixed by the workspace or a previous decision.
Return no questions when the request is clear or project conventions resolve the choice.
Otherwise ask normally one and at most two independent questions about unresolved behavior or real trade-offs.
Each question has a brief rationale, two or three distinct concrete options and a recommended option. Never replace an indispensable user choice with a default.
Never ask for permission to proceed. Use the same language as the request.`

function questionResolvedByFacts(question: InterviewQuestion, facts: ProjectPlanningFacts): boolean {
  const text = question.question.toLowerCase()
  const categories = [
    { pattern: /\b(workspace|progetto|project|greenfield|esistente|existing)\b/, known: facts.workspace !== 'unknown' },
    { pattern: /\b(linguaggio|language|stack|framework)\b/, known: facts.stack.languages.length > 0 },
    { pattern: /\b(package manager|gestore pacchetti|npm|pnpm|yarn|cargo)\b/, known: facts.stack.packageManagers.length > 0 },
    { pattern: /\b(test framework|framework di test|vitest|jest|pytest)\b/, known: facts.stack.testFrameworks.length > 0 },
    { pattern: /\b(build tool|strumento di build|vite|webpack)\b/, known: facts.stack.buildTools.length > 0 },
    { pattern: /\b(verifica|verification|build command|comando di build|test command)\b/, known: facts.verificationCommands.length > 0 },
  ]
  if (categories.some(({ pattern, known }) => known && pattern.test(text))) return true
  return facts.previousDecisions.some((decision) => decision.question.trim().toLowerCase() === text.trim())
}

export class AgentInterviewAppService {
  async conductInterview(
    prompt: string,
    model: string | undefined,
    settings: AppSettings,
    workspacePath?: string | null,
    previousDecisions: readonly UserInterviewAnswer[] = []
  ): Promise<InterviewAnalysisResult> {
    const modelToUse = model || settings.codingModel || settings.defaultModel || 'qwen2.5-coder:7b'
    const cachedGpu = getCachedGpuInfo()
    const memInfo = getMemoryInfo()
    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: cachedGpu?.hasNvidiaGpu,
      vramTotalMB: cachedGpu?.vramTotalMB,
      systemRamGB: memInfo?.totalRAMGB,
      cpuCount: os.cpus()?.length,
    })
    runtimeOpts.num_ctx = resolveModelContextLength(modelToUse, settings.modelContextLengths, runtimeOpts.num_ctx)
    runtimeOpts.num_predict = Math.min(HardwareProfileResolver.deriveNumPredict(runtimeOpts.num_ctx), 768)
    runtimeOpts.maxContextChars = HardwareProfileResolver.deriveMaxContextChars(runtimeOpts.num_ctx)

    try {
      const { facts } = collectProjectPlanningFacts(workspacePath, prompt, previousDecisions)
      const response = await ollamaAppService.generateStructured({
        model: modelToUse,
        systemPrompt: INTERVIEW_SYSTEM_PROMPT,
        userContent: JSON.stringify({ request: prompt, projectFacts: facts }),
        format: toOllamaJsonSchema(interviewPhaseResponseSchema),
        host: settings.ollamaHost,
        options: runtimeOpts,
      })

      if (response.status !== 'complete') {
        logger.log('WARN', 'AgentInterviewAppService', `Interview generation ${response.status}: ${response.error}`)
        return {
          status: 'error',
          hasQuestions: false,
          questions: [],
          rawResponse: response.content,
          error: response.error,
        }
      }

      const validated = validateStructuredContent(response.content, interviewPhaseResponseSchema)
      if (validated.status === 'invalid') {
        logger.log('WARN', 'AgentInterviewAppService', `Interview schema rejected: ${validated.error}`)
        return {
          status: 'error',
          hasQuestions: false,
          questions: [],
          rawResponse: response.content,
          error: `Invalid interview response: ${validated.error}`,
        }
      }

      const unresolvedQuestions = validated.data.questions.filter((question) => !questionResolvedByFacts(question, facts))
      const languageError = validateInterviewQuestionLanguage(prompt, unresolvedQuestions)
      if (languageError) {
        return {
          status: 'error',
          hasQuestions: false,
          questions: [],
          rawResponse: response.content,
          error: `Invalid interview response: ${languageError}`,
        }
      }
      if (!validated.data.hasQuestions || unresolvedQuestions.length === 0) {
        return {
          status: 'completed',
          hasQuestions: false,
          questions: [],
          rawResponse: response.content,
        }
      }

      return {
        status: 'clarification_required',
        hasQuestions: true,
        questions: unresolvedQuestions as InterviewQuestion[],
        rawResponse: response.content,
      }
    } catch (parseErr: any) {
      logger.log('WARN', 'AgentInterviewAppService', `Failed to parse interview response: ${parseErr.message}`)
      return { status: 'error', hasQuestions: false, questions: [], error: parseErr.message }
    }
  }

  /**
   * Enriches the original user prompt with the confirmed interview answers.
   */
  enrichPromptWithAnswers(
    originalPrompt: string,
    answers: UserInterviewAnswer[],
    questions: InterviewQuestion[]
  ): string {
    const validated = validateInterviewAnswers(questions || [], answers || [])
    if (!validated.valid) throw new Error(`Invalid interview answers: ${validated.error}`)
    return composeInterviewDecisionPrompt(originalPrompt, validated.answers)
  }
}

export const agentInterviewAppService = new AgentInterviewAppService()
