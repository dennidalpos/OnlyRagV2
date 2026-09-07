import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  ensureMandatoryStopDirective,
  MANDATORY_PLAN_STOP_ITEM,
  resolveInterviewPrompt,
  usePlanApproval,
} from './usePlanApproval'
import { createAcceptedRecommendationAnswers } from '../../shared/domain/agent/interviewDecisionContext'
import type { AgentPlan, AppSettings, IElectronAPI, UserInterviewAnswer } from '../types'

describe('usePlanApproval & Plan Refactoring Unit Tests', () => {
  it('should automatically append mandatory stop directive to generated plan text', () => {
    const rawPlan = `🎯 Piano di Esecuzione v1
1. 🔍 Analisi dei file sorgenti
2. ✏️ Implementazione del refactoring`

    const formatted = ensureMandatoryStopDirective(rawPlan)
    expect(formatted).toContain(MANDATORY_PLAN_STOP_ITEM)
    expect(formatted).toContain('3. 🛑 Completamento dell\'ultimo task, riepilogo finale e arresto dell\'agente (invoke "finish")')
  })

  it('should not duplicate mandatory stop directive if already present in plan text', () => {
    const planWithStop = `🎯 Piano di Esecuzione v1
1. 🔍 Analisi dei file sorgenti
2. 🛑 Completamento dell'ultimo task, riepilogo finale e arresto dell'agente (invoke "finish")`

    const formatted = ensureMandatoryStopDirective(planWithStop)
    const matches = formatted.match(/Completamento dell'ultimo task/g)
    expect(matches).toHaveLength(1)
  })

  it('turns "skip and use recommended" into accepted decisions instead of discarding them', () => {
    const answers = createAcceptedRecommendationAnswers([
      {
        id: 'router',
        question: 'Quale router?',
        options: ['React Router', 'Router custom'],
        recommendedIndex: 0,
      },
    ])

    expect(answers).toEqual([
      expect.objectContaining({
        questionId: 'router',
        selectedOption: 'React Router',
        provenance: 'accepted_recommendation',
      }),
    ])
  })

  it('falls back to a lossless local prompt when IPC enrichment fails', async () => {
    const reportFailure = vi.fn()
    const originalPrompt = 'Crea una dashboard con filtri'
    const answers = [{
      questionId: 'storage',
      questionText: 'Persistenza',
      selectedOption: 'localStorage',
      provenance: 'explicit' as const,
    }]

    const effectivePrompt = await resolveInterviewPrompt(
      originalPrompt,
      answers,
      vi.fn().mockRejectedValue(new Error('IPC unavailable')),
      reportFailure
    )

    expect(reportFailure).toHaveBeenCalledOnce()
    expect(effectivePrompt).toContain(`[ORIGINAL USER REQUEST]\n${originalPrompt}`)
    expect(effectivePrompt).toContain('[EXPLICIT USER ANSWER] Persistenza: localStorage')
  })

  it('rejects a lossy enrichment result that omits a confirmed decision', async () => {
    const reportFailure = vi.fn()
    const answers = [{
      questionId: 'router',
      questionText: 'Router',
      selectedOption: 'React Router',
      provenance: 'accepted_recommendation' as const,
    }]

    const effectivePrompt = await resolveInterviewPrompt(
      'Build a dashboard',
      answers,
      vi.fn().mockResolvedValue('Build a dashboard'),
      reportFailure
    )

    expect(reportFailure).toHaveBeenCalledOnce()
    expect(effectivePrompt).toContain('[ACCEPTED RECOMMENDATION] Router: React Router')
  })
})

describe('usePlanApproval interview and error flow', () => {
  let container: HTMLDivElement
  let root: Root
  let currentHook: ReturnType<typeof usePlanApproval>
  let onPlanApproved: (plan: AgentPlan) => void

  const settings = {
    codingModel: 'qwen2.5-coder:7b',
    enablePrePlanInterview: true,
    autoProceedPlan: false,
    enableSoundEffects: false,
  } as AppSettings

  function installElectronApi(api: Partial<IElectronAPI>) {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: api,
    })
  }

  function Harness() {
    const [plans, setPlans] = useState<AgentPlan[]>([])
    currentHook = usePlanApproval({
      settings,
      activeSessionId: 'session-1',
      workspacePath: '/repo',
      sessionPlans: plans,
      onSessionPlansChange: setPlans,
      onPlanApproved,
    })
    return null
  }

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    onPlanApproved = vi.fn<(plan: AgentPlan) => void>()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(React.createElement(Harness)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses recommended answers for planning, seeding and approval without reading the composer again', async () => {
    const agentPlanGenerate = vi.fn().mockResolvedValue({
      status: 'success',
      planText: '- [ ] Implementa il router — `src/router.ts`',
      milestones: [{ id: 'm-1', title: 'Implementa il router — `src/router.ts`', status: 'pending' }],
    })
    const agentPlanSeed = vi.fn().mockResolvedValue(true)
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({
        status: 'clarification_required',
        hasQuestions: true,
        questions: [{ id: 'router', question: 'Quale router?', options: ['React Router', 'Custom'], recommendedIndex: 0 }],
      }),
      agentPlanEnrichPrompt: vi.fn(async (prompt: string, answers: UserInterviewAnswer[]) =>
        `[ORIGINAL USER REQUEST]\n${prompt}\n\n[INTERVIEW DECISIONS]\n- [ACCEPTED RECOMMENDATION] Router: ${answers[0].selectedOption}`
      ),
      agentPlanGenerate,
      agentPlanParseText: vi.fn().mockResolvedValue([{ id: 'm-1', title: 'Implementa il router', status: 'pending' }]),
      agentPlanSeed,
    })

    await act(async () => {
      await currentHook.startPlanFlow('Crea una dashboard')
    })
    expect(currentHook.isInterviewActive).toBe(true)

    await act(async () => {
      await currentHook.skipInterviewWithRecommended()
    })

    expect(agentPlanGenerate).toHaveBeenCalledWith(
      expect.stringContaining('[ACCEPTED RECOMMENDATION] Router: React Router'),
      'qwen2.5-coder:7b',
      settings,
      undefined,
      '/repo'
    )
    expect(currentHook.currentPlan).toMatchObject({
      status: 'ready',
      originalPrompt: 'Crea una dashboard',
      interviewAnswers: [expect.objectContaining({ selectedOption: 'React Router', provenance: 'accepted_recommendation' })],
    })

    await act(async () => {
      await currentHook.handleApprovePlan()
    })

    const effectivePrompt = expect.stringContaining('[ACCEPTED RECOMMENDATION] Router: React Router')
    expect(agentPlanSeed).toHaveBeenCalledWith('session-1', '/repo', expect.any(Array), effectivePrompt)
    expect(onPlanApproved).toHaveBeenCalledWith(expect.objectContaining({ prompt: effectivePrompt, status: 'approved' }))
  })

  it('keeps a planning error non-executable and retries with the same decisions', async () => {
    const agentPlanGenerate = vi.fn()
      .mockResolvedValueOnce({
        status: 'error',
        planText: '- [ ] Bozza parziale — `src/theme.ts`',
        milestones: [{ id: 'm-1', title: 'Bozza parziale — `src/theme.ts`', status: 'pending' }],
        error: 'stream interrupted',
      })
      .mockResolvedValueOnce({
        status: 'success',
        planText: '- [ ] Applica il tema — `src/theme.ts`',
        milestones: [{ id: 'm-1', title: 'Applica il tema — `src/theme.ts`', status: 'pending' }],
      })
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({
        status: 'clarification_required',
        hasQuestions: true,
        questions: [{ id: 'theme', question: 'Quale tema?', options: ['Scuro', 'Chiaro'], recommendedIndex: 0 }],
      }),
      agentPlanEnrichPrompt: vi.fn(async (prompt: string, answers: UserInterviewAnswer[]) =>
        `[ORIGINAL USER REQUEST]\n${prompt}\n\n[INTERVIEW DECISIONS]\n- [EXPLICIT USER ANSWER] Tema: ${answers[0].selectedOption}`
      ),
      agentPlanGenerate,
      agentPlanParseText: vi.fn().mockResolvedValue([{ id: 'm-1', title: 'Applica il tema', status: 'pending' }]),
      agentPlanSeed: vi.fn().mockResolvedValue(true),
    })

    await act(async () => {
      await currentHook.startPlanFlow('Crea una dashboard')
      await currentHook.confirmInterviewAnswers([{
        questionId: 'theme',
        questionText: 'Quale tema?',
        selectedOption: 'Chiaro',
        provenance: 'explicit',
      }])
    })

    expect(currentHook.currentPlan).toMatchObject({
      status: 'error',
      errorPhase: 'planning',
      errorMessage: 'stream interrupted',
      planText: '- [ ] Bozza parziale — `src/theme.ts`',
    })
    await act(async () => {
      await currentHook.handleApprovePlan()
    })
    expect(onPlanApproved).not.toHaveBeenCalled()

    await act(async () => {
      await currentHook.retryCurrentPlan()
    })

    expect(agentPlanGenerate).toHaveBeenCalledTimes(2)
    expect(agentPlanGenerate.mock.calls[1][0]).toContain('[EXPLICIT USER ANSWER] Tema: Chiaro')
    expect(currentHook.currentPlan).toMatchObject({
      status: 'ready',
      originalPrompt: 'Crea una dashboard',
      interviewAnswers: [expect.objectContaining({ selectedOption: 'Chiaro', provenance: 'explicit' })],
    })
  })

  it('stops after an interview error instead of generating a plan', async () => {
    const agentPlanGenerate = vi.fn()
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({
        status: 'error',
        hasQuestions: false,
        questions: [],
        rawResponse: '{partial',
        error: 'Invalid interview response',
      }),
      agentPlanGenerate,
    })

    await act(async () => {
      await currentHook.startPlanFlow('Crea una dashboard')
    })

    expect(agentPlanGenerate).not.toHaveBeenCalled()
    expect(currentHook.currentPlan).toMatchObject({
      status: 'error',
      errorPhase: 'interview',
      errorMessage: 'Invalid interview response',
      planText: '{partial',
    })
  })
})
