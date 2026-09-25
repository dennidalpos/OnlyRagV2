import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentProgressPolicy } from '../domain/agent/agentProgressPolicy'
import type { AppSettings } from '../../../shared/types'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { runProjectVerification } from './agentOrchestratorVerificationRunner'
import { closeAgentRunFromEvidence, type ApplicationClosureContext } from './agentOrchestratorApplicationClosure'
import { renderAgentLines } from '../../../shared/domain/agent/agentMainText'

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

  function makeContext(options?: { active?: boolean; milestoneStatus?: 'pending' | 'in_progress' | 'verified' | 'failed'; hasFileMutations?: boolean }) {
    const filePath = path.join(workspacePath, 'src', 'app.ts')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, 'export const value = 1\n')

    const goalPlanner = new GoalDecompositionPlanner()
    goalPlanner.initializePlan([
      {
        id: 'm-1',
        title: 'Create `src/app.ts`',
        status: options?.milestoneStatus ?? 'in_progress',
      },
    ])
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
        progress: new AgentProgressPolicy(),
        verificationFixCycles: 0,
        guardEvents: [],
        versionEvidence: {},
      },
      goalPlanner,
      episodicCompactor,
      isSessionActive: () => active,
      emitLog,
      emitDone,
      persistCurrentState,
      buildSessionTracker: (summaryText?: string) =>
        new SessionDebtTracker({
          completedTasks: goalPlanner
            .getMilestones()
            .filter((m) => m.status === 'verified')
            .map((m) => `${m.id}: ${m.title}`),
          unresolvedIssues: goalPlanner
            .getMilestones()
            .filter((m) => m.status === 'failed')
            .map((m) => `${m.id}: ${m.title}`),
          nextSteps: goalPlanner
            .getMilestones()
            .filter((m) => m.status === 'pending' || m.status === 'in_progress')
            .map((m) => `${m.id}: ${m.title}`),
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
      recordVerificationEvidence: (evidence) => {
        ctx.lastVerification = evidence
      },
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
    const { ctx, emitDone, emitLog, persistCurrentState, finalizeSession, setExecutionPhase, filePath } = makeContext()

    const outcome = await closeAgentRunFromEvidence(ctx, {
      trigger: 'model_silence',
      reason: { key: 'reasonSummaryWithoutFinish' },
      modelSummary: 'Implemented the requested change.',
    })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: true, completionStatus: 'verified' } })
    expect(emitDone).toHaveBeenCalledWith(
      true,
      expect.stringContaining('VERIFICATO'),
      'verified',
      expect.objectContaining({
        changedFiles: [filePath],
        cancellationStatus: 'not_cancelled',
        verification: expect.objectContaining({ status: 'verified', command: 'npm test' }),
        nonRollbackEffects: [],
      }),
    )
    expect(persistCurrentState).toHaveBeenCalledWith('model_silence', 'verified')
    expect(ctx.lastVerification).toMatchObject({ status: 'verified', command: 'npm test' })
    expect(emitLog).toHaveBeenCalledWith(
      'info',
      'Diagnostica sessione: verified',
      expect.stringContaining('Recupero schema: 0/2'),
      expect.objectContaining({ category: 'generic_info', modelName: 'qwen2.5-coder:7b' }),
    )
    const diagnosticCall = emitLog.mock.calls.find((call) => call[1] === 'Diagnostica sessione: verified')
    const [, , diagnosticDetail, diagnosticMeta] = diagnosticCall!
    expect(diagnosticMeta.localized.message).toEqual({ key: 'diagnosticMessage', params: { status: 'verified' } })
    expect(diagnosticMeta.localized.detail).toContainEqual({ key: 'diagnosticStopReason', params: { reason: { key: 'reasonSummaryWithoutFinish' } } })
    expect(renderAgentLines(diagnosticMeta.localized.detail)).toBe(diagnosticDetail)
    expect(diagnosticDetail).toContain('Motivo di stop: Il modello ha consegnato il riepilogo finale senza richiedere un tool di chiusura.')
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

    const outcome = await closeAgentRunFromEvidence(ctx, { trigger: 'finish', reason: { key: 'reasonFinish' } })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: false, completionStatus: 'unverifiable' } })
    if (outcome.outcome === 'closed') expect(outcome.result.summary).toContain('non provano il comportamento end-to-end')
    expect(persistCurrentState).toHaveBeenCalledWith('finish', 'unverifiable')
  })

  it('publishes an isolated workspace only after the final approval', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: true,
      status: 'verified',
      passed: true,
      command: 'npm test',
      evidenceLevel: 'behavioral',
    })
    const { ctx } = makeContext({ milestoneStatus: 'verified' })
    const transaction = {
      sourcePath: 'C:/workspace',
      preview: vi.fn(() => ({ changedPaths: ['src/app.ts'], createdCount: 0, deletedCount: 0, modifiedCount: 1 })),
      publish: vi.fn(() => ({ success: true, changedPaths: ['src/app.ts'] })),
      dispose: vi.fn(),
    }
    ctx.workspaceTransaction = transaction as never
    ctx.requestApproval = vi.fn(async () => ({ approved: true }))

    const outcome = await closeAgentRunFromEvidence(ctx, { trigger: 'finish', reason: { key: 'reasonFinish' } })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { completionStatus: 'verified' } })
    expect(ctx.requestApproval).toHaveBeenCalledWith(expect.objectContaining({ type: 'publish_workspace', target: 'C:/workspace' }))
    expect(transaction.publish).toHaveBeenCalledOnce()
    expect(transaction.dispose).toHaveBeenCalledOnce()
  })

  it('re-previews and separately approves the source Git commit after publication', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: true,
      status: 'verified',
      passed: true,
      command: 'npm test',
      evidenceLevel: 'behavioral',
    })
    const { ctx, filePath } = makeContext({ milestoneStatus: 'verified' })
    execFileSync('git', ['init'], { cwd: workspacePath })
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: workspacePath })
    execFileSync('git', ['config', 'user.name', 'OnlyRag Test'], { cwd: workspacePath })
    execFileSync('git', ['add', '--', 'src/app.ts'], { cwd: workspacePath })
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: workspacePath })
    const transaction = {
      sourcePath: workspacePath,
      preview: vi.fn(() => ({ changedPaths: ['src/app.ts'], createdCount: 0, deletedCount: 0, modifiedCount: 1 })),
      publish: vi.fn(() => {
        fs.writeFileSync(filePath, 'export const value = 2\n')
        return { success: true, changedPaths: ['src/app.ts'] }
      }),
      dispose: vi.fn(),
    }
    ctx.workspaceTransaction = transaction as never
    ctx.requestApproval = vi.fn(async () => ({ approved: true }))

    await closeAgentRunFromEvidence(ctx, { trigger: 'finish', reason: { key: 'reasonFinish' } })

    expect(ctx.requestApproval).toHaveBeenCalledTimes(2)
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: workspacePath, encoding: 'utf8' }).trim()).toBe('Agent Coding: publish reviewed changes')
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
      reason: { key: 'reasonTransportError', params: { step: 3, error: 'LLM transport disconnected.' } },
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

    const outcome = await closeAgentRunFromEvidence(ctx, { trigger: 'step_budget', reason: { key: 'reasonStepBudget', params: { max: 10 } } })

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
      reason: { key: 'reasonStepBudget', params: { max: 10 } },
    })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: false, completionStatus: 'blocked' } })
    if (outcome.outcome === 'closed') {
      expect(outcome.result.summary).toContain('limite massimo')
      expect(outcome.result.summary).toContain('Residuo (1)')
      expect(outcome.result.summary).toContain('m-1: Create `src/app.ts`')
    }
    expect(persistCurrentState).toHaveBeenCalledWith('step_budget', 'blocked')
  })

  it('records the stopping guard and reports every guard firing in the completion evidence', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({ hasVerificationCommand: false, status: 'unverifiable' })
    const { ctx, emitDone, emitLog } = makeContext({ milestoneStatus: 'in_progress' })
    ctx.state.guardEvents.push({ guard: 'loop_exact_repeat', action: 'advise', step: 5 })

    const outcome = await closeAgentRunFromEvidence(ctx, {
      trigger: 'guard_stop',
      guard: 'no_mutation',
      reason: { key: 'reasonNoMutation', params: { steps: 12 } },
    })

    const expected = [
      { guard: 'loop_exact_repeat', action: 'advise', step: 5 },
      { guard: 'no_mutation', action: 'stop', step: 7 },
    ]
    expect(ctx.state.guardEvents).toEqual(expected)
    expect(outcome).toMatchObject({ outcome: 'closed', result: { evidence: { guardEvents: expected } } })
    expect(emitDone).toHaveBeenCalledWith(false, expect.any(String), 'blocked', expect.objectContaining({ guardEvents: expected }))
    expect(emitLog).toHaveBeenCalledWith(
      'info',
      'Diagnostica sessione: blocked',
      expect.stringContaining('Guard: loop_exact_repeat, no_mutation(stop)'),
      expect.anything(),
    )
  })

  it('closes a guard-stopped run as blocked even without an operational plan or failing check', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: true,
      status: 'verified',
      passed: true,
      command: 'npm run build',
      evidenceLevel: 'structural',
    })
    const { ctx, emitDone } = makeContext({ milestoneStatus: 'verified' })

    const outcome = await closeAgentRunFromEvidence(ctx, {
      trigger: 'guard_stop',
      guard: 'execution_budget',
      reason: { key: 'reasonExecutionRecovery', params: { diagnostic: 'execution recovery stopped after 2/2 failures' } },
    })

    expect(outcome).toMatchObject({ outcome: 'closed', result: { success: false, completionStatus: 'blocked' } })
    if (outcome.outcome === 'closed') expect(outcome.result.summary).toContain('Run fermato dal guard "execution_budget"')
    expect(emitDone).toHaveBeenCalledWith(false, expect.any(String), 'blocked', expect.anything())
  })

  it('emits the closure summary as message keys whose Italian rendering is the summary text', async () => {
    vi.mocked(runProjectVerification).mockResolvedValue({
      hasVerificationCommand: true,
      status: 'verified',
      passed: true,
      command: 'npm run build',
      evidenceLevel: 'structural',
    })
    const { ctx, emitLog } = makeContext({ milestoneStatus: 'verified' })

    const outcome = await closeAgentRunFromEvidence(ctx, {
      trigger: 'guard_stop',
      guard: 'execution_budget',
      reason: { key: 'reasonExecutionRecovery', params: { diagnostic: 'execution recovery stopped after 2/2 failures' } },
    })

    const closureCall = emitLog.mock.calls.find((call) => call[1] === 'Chiusura applicativa: blocked')
    expect(closureCall).toBeDefined()
    const [, , detail, meta] = closureCall!
    expect(meta.localized.message).toEqual({ key: 'closureMessage', params: { status: 'blocked' } })
    expect(meta.localized.detail[0]).toEqual({ key: 'closureOutcomeBlocked' })
    expect(meta.localized.detail[2]).toEqual({
      key: 'closureEvidence',
      params: {
        evidence: {
          key: 'evidenceGuardStop',
          params: { guard: 'execution_budget', evidence: { key: 'evidenceStructuralPassedCommand', params: { command: 'npm run build' } } },
        },
      },
    })
    expect(renderAgentLines(meta.localized.detail)).toBe(detail)
    if (outcome.outcome === 'closed') expect(outcome.result.summary).toBe(detail)
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
      reason: { key: 'reasonFinish' },
      allowCorrection: true,
    })

    expect(outcome).toEqual({ outcome: 'continue' })
    expect(ctx.state.verificationFixCycles).toBe(1)
    expect(persistCurrentState).toHaveBeenCalledWith()
    expect(finalizeSession).not.toHaveBeenCalled()
  })
})
