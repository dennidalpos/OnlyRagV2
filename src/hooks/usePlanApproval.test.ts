import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  resolveInterviewPrompt,
  usePlanApproval,
} from './usePlanApproval'
import { createAcceptedRecommendationAnswers } from '../../shared/domain/agent/interviewDecisionContext'
import type {
  AgentPlan,
  AppSettings,
  IElectronAPI,
  InterviewAnalysisResult,
  UserInterviewAnswer,
} from '../types'

describe('usePlanApproval & Plan Refactoring Unit Tests', () => {
  it('turns "skip and use recommended" into accepted decisions instead of discarding them', () => {
    const answers = createAcceptedRecommendationAnswers([
      {
        id: 'router',
        question: 'Quale router?',
        rationale: 'La scelta cambia la navigazione.',
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
  let onPersistPlan: (plan: AgentPlan) => Promise<boolean>
  let initialPlans: AgentPlan[]
  let harnessSessionId: string
  let harnessWorkspacePath: string

  const settings = {
    codingModel: 'qwen2.5-coder:7b',
    enablePrePlanInterview: true,
    enableSoundEffects: false,
  } as unknown as AppSettings

  const planResult = (milestones: AgentPlan['milestones'], overrides: Record<string, unknown> = {}) => ({
    status: 'success',
    objective: 'Complete the requested task',
    decisions: [],
    retainedEvidence: [],
    supersededWork: [],
    milestones,
    ...overrides,
  })

  function installElectronApi(api: Partial<IElectronAPI>) {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: api,
    })
  }

  function Harness() {
    const [plans, setPlans] = useState<AgentPlan[]>(() => initialPlans)
    currentHook = usePlanApproval({
      settings,
      activeSessionId: harnessSessionId,
      workspacePath: harnessWorkspacePath,
      sessionPlans: plans,
      onSessionPlansChange: setPlans,
      onPersistPlan,
      onPlanApproved,
    })
    return null
  }

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    onPlanApproved = vi.fn<(plan: AgentPlan) => void>()
    onPersistPlan = vi.fn<(plan: AgentPlan) => Promise<boolean>>().mockResolvedValue(true)
    initialPlans = []
    harnessSessionId = 'session-1'
    harnessWorkspacePath = '/repo'
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
    const agentPlanGenerate = vi.fn().mockResolvedValue(planResult([
      { id: 'm-1', title: 'Implementa il router', filePaths: ['src/router.ts'], acceptanceCriteria: ['Il router funziona'], status: 'pending' },
    ]))
    const agentPlanSeed = vi.fn().mockResolvedValue(true)
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({
        status: 'clarification_required',
        hasQuestions: true,
        questions: [{ id: 'router', question: 'Quale router?', rationale: 'La scelta cambia la navigazione.', options: ['React Router', 'Custom'], recommendedIndex: 0 }],
      }),
      agentPlanEnrichPrompt: vi.fn(async (prompt: string, answers: UserInterviewAnswer[]) =>
        `[ORIGINAL USER REQUEST]\n${prompt}\n\n[INTERVIEW DECISIONS]\n- [ACCEPTED RECOMMENDATION] Router: ${answers[0].selectedOption}`
      ),
      agentPlanGenerate,
      agentPlanSeed,
    })

    await act(async () => {
      await currentHook.startPlanFlow('Quale router scegliere: React Router o Custom?')
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
      '/repo',
      [expect.objectContaining({ selectedOption: 'React Router', provenance: 'accepted_recommendation' })],
    )
    expect(currentHook.currentPlan).toMatchObject({
      status: 'ready',
      originalPrompt: 'Quale router scegliere: React Router o Custom?',
      interviewAnswers: [expect.objectContaining({ selectedOption: 'React Router', provenance: 'accepted_recommendation' })],
    })

    await act(async () => {
      await currentHook.handleApprovePlan()
    })

    const effectivePrompt = expect.stringContaining('[ACCEPTED RECOMMENDATION] Router: React Router')
    expect(onPersistPlan).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', milestones: expect.any(Array) }))
    expect(agentPlanSeed).toHaveBeenCalledWith('session-1', '/repo', expect.any(Array), effectivePrompt)
    expect(onPlanApproved).toHaveBeenCalledWith(expect.objectContaining({ prompt: effectivePrompt, status: 'approved' }))
  })

  it('keeps a planning error non-executable and retries with the same decisions', async () => {
    const agentPlanGenerate = vi.fn()
      .mockResolvedValueOnce(planResult(
        [{ id: 'm-1', title: 'Bozza parziale', filePaths: ['src/theme.ts'], status: 'pending' }],
        { status: 'error', error: 'stream interrupted' }
      ))
      .mockResolvedValueOnce(planResult([
        { id: 'm-1', title: 'Applica il tema', filePaths: ['src/theme.ts'], status: 'pending' },
      ]))
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({
        status: 'clarification_required',
        hasQuestions: true,
        questions: [{ id: 'theme', question: 'Quale tema?', rationale: 'La scelta cambia la presentazione.', options: ['Scuro', 'Chiaro'], recommendedIndex: 0 }],
      }),
      agentPlanEnrichPrompt: vi.fn(async (prompt: string, answers: UserInterviewAnswer[]) =>
        `[ORIGINAL USER REQUEST]\n${prompt}\n\n[INTERVIEW DECISIONS]\n- [EXPLICIT USER ANSWER] Tema: ${answers[0].selectedOption}`
      ),
      agentPlanGenerate,
      agentPlanSeed: vi.fn().mockResolvedValue(true),
    })

    await act(async () => {
      await currentHook.startPlanFlow('Quale tema scegliere: Scuro o Chiaro?')
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
      objective: 'Complete the requested task',
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
      originalPrompt: 'Quale tema scegliere: Scuro o Chiaro?',
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
      await currentHook.startPlanFlow('Quale storage scegliere: SQLite o JSON?')
    })

    expect(agentPlanGenerate).not.toHaveBeenCalled()
    expect(currentHook.currentPlan).toMatchObject({
      status: 'error',
      errorPhase: 'interview',
      errorMessage: 'Invalid interview response',
      objective: 'Quale storage scegliere: SQLite o JSON?',
    })
  })

  it('sends a clear request directly to the planner', async () => {
    const agentPlanInterview = vi.fn()
    const agentPlanGenerate = vi.fn().mockResolvedValue(planResult([
      { id: 'm-1', title: 'Correggi il bootstrap', filePaths: ['src/main.tsx'], status: 'pending' },
    ]))
    installElectronApi({ agentPlanInterview, agentPlanGenerate })

    await act(async () => {
      await currentHook.startPlanFlow('Correggi il bootstrap in src/main.tsx')
    })

    expect(agentPlanInterview).not.toHaveBeenCalled()
    expect(agentPlanGenerate).toHaveBeenCalledOnce()
    expect(currentHook.currentPlan).toMatchObject({ status: 'ready' })
  })

  it('keeps the backend-compiled milestones as the displayed and approved revision', async () => {
    const compiledMilestones = [
      { id: 'm-1', title: 'Mantiene il requisito di ingresso — `src/main.tsx`', status: 'pending' as const },
      { id: 'm-2', title: 'Verifica il progetto', status: 'pending' as const, verificationCommand: 'npm run build' },
    ]
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({ status: 'ready', hasQuestions: false, questions: [] }),
      agentPlanGenerate: vi.fn().mockResolvedValue(planResult(compiledMilestones, {
        objective: 'Correggere il bootstrap',
        decisions: [{ id: 'a-1', statement: 'Conserva lo stack', source: 'assumption' }],
      })),
      agentPlanSeed: vi.fn().mockResolvedValue(true),
    })

    await act(async () => {
      await currentHook.startPlanFlow('Correggi il bootstrap')
    })

    expect(currentHook.currentPlan?.milestones).toEqual(compiledMilestones)
    expect(currentHook.currentPlan).toMatchObject({
      objective: 'Correggere il bootstrap',
      decisions: [{ id: 'a-1', statement: 'Conserva lo stack', source: 'assumption' }],
    })

    await act(async () => {
      await currentHook.handleApprovePlan()
    })

    expect(onPersistPlan).toHaveBeenCalledWith(expect.objectContaining({ milestones: compiledMilestones }))
    expect(onPlanApproved).toHaveBeenCalledWith(expect.objectContaining({ milestones: compiledMilestones }))
  })

  it('persists a validated review before replacing the visible plan revision', async () => {
    installElectronApi({
      agentPlanGenerate: vi.fn().mockResolvedValue(planResult([
        { id: 'm-1', title: 'Crea pagina', filePaths: ['src/Page.tsx'], status: 'pending' },
      ])),
    })
    await act(async () => {
      await currentHook.startPlanFlow('Crea pagina')
    })
    const revision = { ...currentHook.currentPlan!, objective: 'Pagina accessibile' }

    let saved = false
    await act(async () => {
      saved = await currentHook.savePlanReview(revision)
    })

    expect(saved).toBe(true)
    expect(onPersistPlan).toHaveBeenCalledWith(revision)
    expect(currentHook.currentPlan?.objective).toBe('Pagina accessibile')
    expect(currentHook.isSavingPlanReview).toBe(false)
  })

  it('does not execute when seeding returns false and leaves the revision retryable', async () => {
    const agentPlanSeed = vi.fn().mockResolvedValue(false)
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({ status: 'ready', hasQuestions: false, questions: [] }),
      agentPlanGenerate: vi.fn().mockResolvedValue(planResult([
        { id: 'm-1', title: 'Task', filePaths: ['src/task.ts'], status: 'pending' },
      ])),
      agentPlanSeed,
    })

    await act(async () => {
      await currentHook.startPlanFlow('Task')
    })
    await act(async () => {
      await currentHook.handleApprovePlan()
    })

    expect(onPlanApproved).not.toHaveBeenCalled()
    expect(currentHook.currentPlan).toMatchObject({ status: 'ready' })
    expect(currentHook.currentPlan?.approvalError).toContain('Preparazione')
    expect(onPersistPlan).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'approved' }))
    expect(onPersistPlan).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'ready' }))
  })

  it('deduplicates approval callbacks while persistence is in flight', async () => {
    let releaseSave!: (value: boolean) => void
    onPersistPlan = vi.fn(() => new Promise<boolean>((resolve) => { releaseSave = resolve }))
    await act(async () => root.render(React.createElement(Harness)))
    const agentPlanSeed = vi.fn().mockResolvedValue(true)
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({ status: 'ready', hasQuestions: false, questions: [] }),
      agentPlanGenerate: vi.fn().mockResolvedValue(planResult([
        { id: 'm-1', title: 'Task', filePaths: ['src/task.ts'], status: 'pending' },
      ])),
      agentPlanSeed,
    })

    await act(async () => {
      await currentHook.startPlanFlow('Task')
    })

    let first!: Promise<void>
    await act(async () => {
      first = currentHook.handleApprovePlan()
      void currentHook.handleApprovePlan()
      await Promise.resolve()
    })
    releaseSave(true)
    await act(async () => {
      await first
    })

    expect(onPersistPlan).toHaveBeenCalledOnce()
    expect(agentPlanSeed).toHaveBeenCalledOnce()
    expect(onPlanApproved).toHaveBeenCalledOnce()
  })

  it('can resume an approved persisted revision after reopening between seed and launch', async () => {
    initialPlans = [{
      formatVersion: 2,
      id: 'plan-reopen',
      version: 1,
      prompt: 'Riprendi il task',
      objective: 'Riprendi il task',
      decisions: [],
      retainedEvidence: [],
      supersededWork: [],
      status: 'approved',
      createdAt: '2026-09-07T00:00:00.000Z',
      milestones: [{ id: 'm-1', title: 'Riprendi', filePaths: ['src/task.ts'], status: 'pending' }],
    }]
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(React.createElement(Harness)))
    const agentPlanSeed = vi.fn().mockResolvedValue(true)
    installElectronApi({ agentPlanSeed })

    await act(async () => {
      await currentHook.handleApprovePlan()
    })

    expect(onPersistPlan).toHaveBeenCalledWith(expect.objectContaining({ id: 'plan-reopen', status: 'approved' }))
    expect(agentPlanSeed).toHaveBeenCalledWith('session-1', '/repo', initialPlans[0].milestones, 'Riprendi il task')
    expect(onPlanApproved).toHaveBeenCalledWith(expect.objectContaining({ id: 'plan-reopen' }))
  })

  it('ignores a late plan response after a newer request starts', async () => {
    let resolveFirst!: (value: any) => void
    const agentPlanGenerate = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(planResult([
        { id: 'm-1', title: 'Nuovo', filePaths: ['src/new.ts'], status: 'pending' },
      ]))
    installElectronApi({
      agentPlanInterview: vi.fn().mockResolvedValue({ status: 'ready', hasQuestions: false, questions: [] }),
      agentPlanGenerate,
      agentPlanSeed: vi.fn().mockResolvedValue(true),
    })

    let first!: Promise<AgentPlan | null>
    await act(async () => {
      first = currentHook.startPlanFlow('Vecchio')
      await Promise.resolve()
    })
    await act(async () => {
      await currentHook.startPlanFlow('Nuovo')
    })
    resolveFirst(planResult([
      { id: 'm-1', title: 'Vecchio', filePaths: ['src/old.ts'], status: 'pending' },
    ]))
    await act(async () => {
      await first
    })

    expect(currentHook.currentPlan?.prompt).toBe('Nuovo')
    expect(currentHook.currentPlan?.objective).toBe('Complete the requested task')
  })

  it('ignores an interview response that arrives after the session changes', async () => {
    let resolveInterview!: (value: InterviewAnalysisResult) => void
    const agentPlanGenerate = vi.fn()
    installElectronApi({
      agentPlanInterview: vi.fn(() => new Promise<InterviewAnalysisResult>((resolve) => { resolveInterview = resolve })),
      agentPlanGenerate,
    })

    let pending!: Promise<AgentPlan | null>
    await act(async () => {
      pending = currentHook.startPlanFlow('Prima di procedere chiedimi quale storage preferisco')
      await Promise.resolve()
    })
    harnessSessionId = 'session-2'
    harnessWorkspacePath = '/repo-2'
    await act(async () => root.render(React.createElement(Harness)))
    resolveInterview({
      status: 'clarification_required',
      hasQuestions: true,
      questions: [{ id: 'late', question: 'Tardiva?', rationale: 'La scelta cambia il comportamento.', options: ['Sì', 'No'], recommendedIndex: 0 }],
    })
    await act(async () => {
      await pending
    })

    expect(currentHook.isInterviewActive).toBe(false)
    expect(currentHook.interviewQuestions).toEqual([])
    expect(agentPlanGenerate).not.toHaveBeenCalled()
  })
})
