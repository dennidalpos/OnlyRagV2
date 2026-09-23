import { describe, it, expect, beforeEach } from 'vitest'
import { handleLoopDetection } from './agentOrchestratorFinishAndLoopGuards'
import { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import { AgentProgressPolicy, PROGRESS_BUDGET } from '../domain/agent/agentProgressPolicy'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import type { AppSettings } from '../../../shared/types'
import type { ResponseInterpreterContext } from './agentOrchestratorResponseInterpreterTypes'

/** Regression cover for the loop guard's outcome awareness. */
describe('handleLoopDetection — successful vs failed repeats', () => {
  const installCall: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm install' } }

  let ctx: ResponseInterpreterContext
  let loopDetector: AgentActionLoopDetector
  let goalPlanner: GoalDecompositionPlanner

  beforeEach(() => {
    loopDetector = new AgentActionLoopDetector(2)
    goalPlanner = new GoalDecompositionPlanner()
    goalPlanner.initializePlan([
      { id: 'm-12', title: 'Install project dependencies', status: 'in_progress' },
      { id: 'm-13', title: 'Implement the UI shell', status: 'pending' },
      { id: 'm-14', title: 'Write the final report', status: 'pending' },
    ])

    ctx = {
      streamedOutput: '',
      agentMode: 'auto',
      stepCount: 12,
      maxSteps: 50,
      isUnlimitedSteps: false,
      workspacePath: process.cwd(),
      settings: { enableCodingAgentDebugLog: false } as unknown as AppSettings,
      sessionId: 'session-loop-outcome-test',
      hasRecentToolFailure: false,
      errorCountInHistory: 0,
      compiledHistoryBlock: '',
      flags: { hasFileMutations: true, hasVerifiedBuild: false },
      surfacedDodReasons: new Set<string>(),
      state: { progress: new AgentProgressPolicy(), verificationFixCycles: 0, guardEvents: [] },
      episodicCompactor: new EpisodicMemoryCompactor(6),
      goalPlanner,
      executionGuard: new TransactionalExecutionGuard(process.cwd()),
      loopDetector,
      emitLog: () => {},
      emitDone: () => {},
      persistCurrentState: async () => {},
      finalizeSession: () => {},
      buildSessionTracker: (() => ({})) as unknown as ResponseInterpreterContext['buildSessionTracker'],
      closeApplicationRun: async () => ({ outcome: 'closed', result: { success: false, summary: 'closed' } }),
    }
  })

  /** Mirrors the orchestrator turn: guard first, tool afterwards, outcome reported last. */
  const runStep = async (call: AgentToolCall, succeeded: boolean) => {
    const outcome = await handleLoopDetection(ctx, call)
    if (outcome === null) loopDetector.recordOutcome(call, succeeded)
    return outcome
  }

  it('does not count a repeat of a SUCCESSFUL command as stagnation', async () => {
    await runStep(installCall, true)
    await runStep(installCall, true)
    const blocked = await runStep(installCall, true)

    expect(blocked).toEqual({ outcome: 'continue' })
    expect(ctx.state.progress.consecutiveLoopBlocks).toBe(0)
    expect(ctx.state.progress.consecutiveRedundantBlocks).toBe(1)
  })

  it('keeps the milestone alive when the repeated command kept succeeding', async () => {
    // Every block the advisory budget allows, so the escalation ladder is never reached.
    for (let i = 0; i < 2 + PROGRESS_BUDGET.redundantSuccessBlocks; i++) await runStep(installCall, true)

    expect(goalPlanner.getMilestones().map((m) => m.status)).not.toContain('failed')
    expect(goalPlanner.findMilestone('m-12')?.status).toBe('in_progress')
  })

  it('still abandons the milestone when the repeated command kept failing', async () => {
    await runStep(installCall, false)
    await runStep(installCall, false)
    await runStep(installCall, false)
    await runStep(installCall, false)

    expect(ctx.state.progress.consecutiveLoopBlocks).toBe(2)
    expect(goalPlanner.findMilestone('m-12')?.status).toBe('failed')
  })

  it('rejoins the stagnation ladder once the redundancy advisory budget is spent', async () => {
    for (let i = 0; i < 2 + PROGRESS_BUDGET.redundantSuccessBlocks; i++) await runStep(installCall, true)
    expect(ctx.state.progress.consecutiveLoopBlocks).toBe(0)

    // One block past the budget: the exemption is bounded, so the session keeps its escape route.
    await runStep(installCall, true)
    expect(ctx.state.progress.consecutiveLoopBlocks).toBe(1)
  })

  it('resets the redundancy streak as soon as the same action starts failing', async () => {
    await runStep(installCall, true)
    await runStep(installCall, true)
    await runStep(installCall, true)
    expect(ctx.state.progress.consecutiveRedundantBlocks).toBe(1)

    // The guard blocked the previous call, so the last reported outcome is still a success;
    // a fresh failing execution has to flip the classification back.
    loopDetector.recordOutcome(installCall, false)
    await runStep(installCall, false)

    expect(ctx.state.progress.consecutiveRedundantBlocks).toBe(0)
    expect(ctx.state.progress.consecutiveLoopBlocks).toBe(1)
  })
  it('records which guard fired and when it re-planned', async () => {
    await runStep(installCall, true)
    await runStep(installCall, true)
    await runStep(installCall, true)
    expect(ctx.state.guardEvents).toEqual([{ guard: 'redundant_success', action: 'advise', step: 12 }])

    ctx.state.guardEvents.length = 0
    loopDetector.recordOutcome(installCall, false)
    await runStep(installCall, false)
    await runStep(installCall, false)

    expect(ctx.state.guardEvents).toEqual([
      { guard: 'loop_exact_repeat', action: 'advise', step: 12 },
      { guard: 'loop_exact_repeat', action: 'advise', step: 12 },
      { guard: 'loop_exact_repeat', action: 'force_advance', step: 12 },
    ])
  })
})
