import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../../shared/types'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { runProjectVerification } from './agentOrchestratorVerificationRunner'
import {
  closeAgentRunFromEvidence,
  type ApplicationClosureContext,
} from './agentOrchestratorApplicationClosure'

vi.mock('./agentOrchestratorVerificationRunner', () => ({
  runProjectVerification: vi.fn(),
}))

describe('application-owned agent closure', () => {
  let workspacePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-application-closure-'))
    vi.mocked(runProjectVerification).mockReset()
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  function makeContext(options?: {
    active?: boolean
    milestoneStatus?: 'pending' | 'in_progress' | 'verified' | 'failed'
    hasFileMutations?: boolean
  }) {
    const filePath = path.join(workspacePath, 'src', 'app.ts')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, 'export const value = 1\n')

    const goalPlanner = new GoalDecompositionPlanner()
    goalPlanner.initializePlan([{
      id: 'm-1',
      title: 'Create `src/app.ts`',
      status: options?.milestoneStatus ?? 'in_progress',
    }])
    const persistCurrentState = vi.fn(async () => {})
    const finalizeSession = vi.fn()
    const emitDone = vi.fn()
    const emitLog = vi.fn()
    const setExecutionPhase = vi.fn()
    const episodicCompactor = new EpisodicMemoryCompactor(6)
    const active = options?.active ?? true

    const ctx: ApplicationClosureContext = {
      workspacePath,
      settings: { verifyBeforeFinish: true, enableCodingAgentDebugLog: false } as AppSettings,
      sessionId: 'closure-session',
      stepCount: 7,
      flags: {
        hasFileMutations: options?.hasFileMutations ?? true,
        hasVerifiedBuild: false,
      },
      state: {
        noToolStreak: 0,
        schemaRejectionStreak: 0,
        stagnationStreak: 0,
        redundantSuccessStreak: 0,
        verificationFixCycles: 0,
      },
      goalPlanner,
      episodicCompactor,
      isSessionActive: () => active,
      emitLog,
      emitDone,
      persistCurrentState,
      buildSessionTracker: (summaryText?: string) => new SessionDebtTracker({
        completedTasks: goalPlanner.getMilestones().filter((m) => m.status === 'verified').map((m) => `${m.id}: ${m.title}`),
        unresolvedIssues: goalPlanner.getMilestones().filter((m) => m.status === 'failed').map((m) => `${m.id}: ${m.title}`),
        nextSteps: goalPlanner.getMilestones().filter((m) => m.status === 'pending' || m.status === 'in_progress').map((m) => `${m.id}: ${m.title}`),
        modifiedFiles: [filePath],
        summaryText,
      }),
      finalizeSession,
      setExecutionPhase,
      getExecutionPhase: () => 'verify',
      runtimeProfile: {
        model: 'qwen2.5-coder:7b',
        host: 'http://127.0.0.1:11434',
        digest: 'sha256:test',
        options: { num_ctx: 8192, num_predict: 2048, maxContextChars: 24000, temperature: 0.1, top_p: 0.9, repeat_penalty: 1.1, stop: [] },
      },
      recordVerificationEvidence: (evidence) => { ctx.lastVerification = evidence },
    }

    return { ctx, emitDone, emitLog, persistCurrentState, finalizeSession, setExecutionPhase, filePath }
  }

  it('returns verified only from passing behavioral evidence', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: true,
      status: 'verified',
      passed: true,
      command: 'npm test',
      evidenceLevel: 'behavioral',
    })
    const { ctx, emitDone, emitLog, persistCurrentState, finalizeSession, setExecutionPhase } = makeContext()

    const outcome = await closeAgentRunFromEvidence(ctx, {
      trigger: 'model_silence',
      reason: 'Final report received.',
      modelSummary: 'Implemented the requested change.',
    })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: true, completionStatus: 'verified' } })
    expect(emitDone).toHaveBeenCalledWith(true, expect.stringContaining('VERIFICATO'), 'verified')
    expect(persistCurrentState).toHaveBeenCalledWith('model_silence', 'verified')
    expect(ctx.lastVerification).toMatchObject({ status: 'verified', command: 'npm test' })
    expect(emitLog).toHaveBeenCalledWith(
      'info',
      'Diagnostica sessione: verified',
      expect.stringContaining('Recupero schema: 0/2'),
      expect.objectContaining({ category: 'generic_info', modelName: 'qwen2.5-coder:7b' })
    )
    expect(setExecutionPhase).toHaveBeenCalledWith('outcome')
    expect(finalizeSession).toHaveBeenCalledTimes(1)
  })

  it('does not mistake a passing build for end-to-end behavioral proof', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: true,
      status: 'verified',
      passed: true,
      command: 'npm run build',
      evidenceLevel: 'structural',
    })
    const { ctx, persistCurrentState } = makeContext()

    const outcome = await closeAgentRunFromEvidence(ctx, { trigger: 'finish', reason: 'Model requested closure.' })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: false, completionStatus: 'unverifiable' } })
    if (outcome.outcome === 'closed') expect(outcome.result.summary).toContain('non provano il comportamento end-to-end')
    expect(persistCurrentState).toHaveBeenCalledWith('finish', 'unverifiable')
  })

  it('keeps partial delivery and the failure reason when verification blocks closure', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: true,
      status: 'failed',
      passed: false,
      command: 'npm test',
      evidenceLevel: 'behavioral',
      failureDetail: '1 integration test failed',
    })
    const { ctx, filePath, persistCurrentState } = makeContext()

    const outcome = await closeAgentRunFromEvidence(ctx, {
      trigger: 'transport_error',
      reason: 'LLM transport disconnected.',
    })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: false, completionStatus: 'blocked' } })
    if (outcome.outcome === 'closed') {
      expect(outcome.result.summary).toContain('LLM transport disconnected')
      expect(outcome.result.summary).toContain('1 integration test failed')
      expect(outcome.result.summary).toContain(filePath)
    }
    expect(persistCurrentState).toHaveBeenCalledWith('transport_error', 'blocked')
  })

  it('never starts verification after cancellation', async () => {
    const { ctx, persistCurrentState, finalizeSession } = makeContext({ active: false })

    const outcome = await closeAgentRunFromEvidence(ctx, { trigger: 'step_budget', reason: 'Budget exhausted.' })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: false, completionStatus: 'cancelled' } })
    expect(runProjectVerification).not.toHaveBeenCalled()
    expect(persistCurrentState).not.toHaveBeenCalled()
    expect(finalizeSession).not.toHaveBeenCalled()
  })

  it('preserves the budget reason and residual work in the terminal checkpoint', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: false,
      status: 'unverifiable',
    })
    const { ctx, persistCurrentState } = makeContext({ milestoneStatus: 'in_progress' })

    const outcome = await closeAgentRunFromEvidence(ctx, {
      trigger: 'step_budget',
      reason: 'Raggiunto il limite massimo di passaggi configurato (10 step).',
    })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: false, completionStatus: 'blocked' } })
    if (outcome.outcome === 'closed') {
      expect(outcome.result.summary).toContain('limite massimo')
      expect(outcome.result.summary).toContain('Residuo (1)')
      expect(outcome.result.summary).toContain('m-1: Create `src/app.ts`')
    }
    expect(persistCurrentState).toHaveBeenCalledWith('step_budget', 'blocked')
  })

  it('allows only bounded correction rounds when finish exposes a failing check', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: true,
      status: 'failed',
      passed: false,
      command: 'npm test',
      evidenceLevel: 'behavioral',
      failureDetail: 'test failed',
    })
    const { ctx, persistCurrentState, finalizeSession } = makeContext()

    const outcome = await closeAgentRunFromEvidence(ctx, {
      trigger: 'finish',
      reason: 'Model requested closure.',
      allowCorrection: true,
    })

    expect(outcome).toEqual({ outcome: 'continue' })
    expect(ctx.state.verificationFixCycles).toBe(1)
    expect(persistCurrentState).toHaveBeenCalledWith()
    expect(finalizeSession).not.toHaveBeenCalled()
  })
})
