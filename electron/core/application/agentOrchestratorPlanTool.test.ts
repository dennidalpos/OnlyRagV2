import { describe, expect, it, vi } from 'vitest'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { DEFAULT_APP_SETTINGS } from '../../../shared/domain/settings/appSettingsDefaults'
import { handleUpdatePlanTool, type UpdatePlanToolContext } from './agentOrchestratorPlanTool'

describe('handleUpdatePlanTool', () => {
  it('rejects updates to a later milestone until the active one is verified', async () => {
    const goalPlanner = new GoalDecompositionPlanner()
    goalPlanner.initializePlan([
      { id: 'm-1', title: 'Create first file', status: 'pending' },
      { id: 'm-2', title: 'Create second file', status: 'pending', verificationCommand: 'npm run build' },
    ])
    const recordStep = vi.fn()
    const persistCurrentState = vi.fn(async () => {})
    const context = {
      parsedTool: { tool: 'update_plan', parameters: { milestoneId: 'm-2', status: 'verified' } },
      goalPlanner,
      workspacePath: null,
      emitLog: vi.fn(),
      emitStepUpdate: vi.fn(),
      episodicCompactor: { recordStep },
      persistCurrentState,
      settings: DEFAULT_APP_SETTINGS,
      sessionId: 'session-1',
      stepCount: 1,
      maxStepsLabel: '50',
    } as unknown as UpdatePlanToolContext

    await handleUpdatePlanTool(context)

    expect(goalPlanner.findMilestone('m-2')?.status).toBe('pending')
    expect(recordStep.mock.calls[0]?.[1]).toContain('OUT OF ORDER')
    expect(persistCurrentState).toHaveBeenCalledOnce()
  })
})
