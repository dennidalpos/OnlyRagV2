import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { UserInterviewAnswer } from '../../shared/types'
import { shouldRunPlanInterview } from '../../shared/domain/agent/planInterviewPolicy'
import { agentInterviewAppService } from '../../electron/core/application/agentInterviewAppService'
import { planGenerationAppService } from '../../electron/core/application/planGenerationAppService'
import { loadRealSettings, resetWorkspace } from './agentLiveHarness'

const MODEL = process.env.ONLYRAG_LIVE_MODEL || 'qwen2.5-coder:7b'
const SAFE_MODEL = MODEL.replace(/[^a-z0-9_-]+/gi, '-')
const WORKSPACE = path.join(os.homedir(), 'Desktop', `onlyrag_live_interview_${SAFE_MODEL}`)

function seedWorkspace(): void {
  resetWorkspace(WORKSPACE)
  fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true })
  fs.writeFileSync(path.join(WORKSPACE, 'package.json'), JSON.stringify({
    name: 'interview-probe',
    private: true,
    scripts: { test: 'node --test' },
  }), 'utf-8')
  fs.writeFileSync(path.join(WORKSPACE, 'src', 'store.js'), 'export const items = []\n', 'utf-8')
}

describe('live: interview qualification', () => {
  it('skips clear work and carries explicit custom answers into planning', async () => {
    seedWorkspace()
    const clear = 'Correggi il nome esportato in src/store.js senza cambiare architettura.'
    const ambiguous = 'Aggiungi persistenza: prima di procedere chiedimi se usare localStorage oppure file JSON.'
    expect(shouldRunPlanInterview(clear)).toBe(false)
    expect(shouldRunPlanInterview(ambiguous)).toBe(true)

    const settings = loadRealSettings({ codingModel: MODEL })
    const interview = await agentInterviewAppService.conductInterview(ambiguous, MODEL, settings, WORKSPACE)
    expect(interview.status, interview.error).toBe('clarification_required')
    expect(interview.questions.length).toBeGreaterThan(0)

    const answers: UserInterviewAnswer[] = interview.questions.map((question, index) => index === 0
      ? {
          questionId: question.id,
          questionText: question.question,
          selectedOption: 'Usa localStorage nel browser, senza backend.',
          isCustom: true,
          provenance: 'explicit',
        }
      : {
          questionId: question.id,
          questionText: question.question,
          selectedOption: question.options[question.recommendedIndex],
          provenance: 'accepted_recommendation',
        })
    const effectivePrompt = agentInterviewAppService.enrichPromptWithAnswers(
      ambiguous,
      answers,
      interview.questions
    )
    const recommendedPrompt = agentInterviewAppService.enrichPromptWithAnswers(
      ambiguous,
      interview.questions.map((question) => ({
        questionId: question.id,
        questionText: question.question,
        selectedOption: question.options[question.recommendedIndex],
        provenance: 'accepted_recommendation',
      })),
      interview.questions
    )
    const plan = await planGenerationAppService.generatePlanText({
      prompt: effectivePrompt,
      model: MODEL,
      settings,
      workspacePath: WORKSPACE,
      previousDecisions: answers,
    })

    console.log(JSON.stringify({ model: MODEL, questions: interview.questions, answers, planStatus: plan.status }))
    expect(effectivePrompt).toContain('Usa localStorage nel browser, senza backend.')
    expect(recommendedPrompt).toContain('[ACCEPTED RECOMMENDATION]')
    expect(plan.status, plan.error).toBe('success')
    expect(plan.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: interview.questions[0].id,
        statement: expect.stringContaining('Usa localStorage nel browser, senza backend.'),
        source: 'explicit_user',
      }),
    ]))
  })
})
