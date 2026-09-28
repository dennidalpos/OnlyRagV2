import { describe, expect, it, vi } from 'vitest'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { DEFAULT_APP_SETTINGS } from '../../../shared/domain/settings/appSettingsDefaults'
import { handleUpdatePlanTool, type UpdatePlanToolContext } from './agentOrchestratorPlanTool'

describe('handleUpdatePlanTool', () => {
  it.each([
    ['layout', 'src/components/Layout.tsx'],
    ['dashboard', 'src/pages/DashboardPage.tsx'],
    ['tasks', 'src/pages/TasksPage.tsx'],
    ['responsive styles', 'src/index.css'],
  ])('does not promote the %s milestone from file presence alone', async (_name, filePath) => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-premature-milestone-'))
    try {
      const absolute = path.join(workspacePath, filePath)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, 'export const ready = true\n')
      const goalPlanner = new GoalDecompositionPlanner()
      goalPlanner.initializePlan([{ id: 'm-1', title: `Create \`${filePath}\``, filePaths: [filePath], status: 'in_progress' }])
      await handleUpdatePlanTool({
        parsedTool: { tool: 'update_plan', parameters: { milestoneId: 'm-1', status: 'verified' } },
        goalPlanner,
        workspacePath,
        emitLog: vi.fn(),
        emitStepUpdate: vi.fn(),
        episodicCompactor: { recordStep: vi.fn() } as never,
        persistCurrentState: vi.fn(async () => {}),
        settings: DEFAULT_APP_SETTINGS,
        sessionId: 'session-1',
        stepCount: 1,
        maxStepsLabel: '50',
      } as UpdatePlanToolContext)
      expect(goalPlanner.findMilestone('m-1')?.status).toBe('in_progress')
      expect(goalPlanner.findMilestone('m-1')?.verificationEvidence).toBeUndefined()
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('refuses model-only verification without a passing project check', async () => {
    const goalPlanner = new GoalDecompositionPlanner()
    goalPlanner.initializePlan([{ id: 'm-1', title: 'Build navigation', status: 'in_progress' }])
    const recordStep = vi.fn()
    const context = {
      parsedTool: { tool: 'update_plan', parameters: { milestoneId: 'm-1', status: 'verified' } },
      goalPlanner,
      workspacePath: null,
      emitLog: vi.fn(),
      emitStepUpdate: vi.fn(),
      episodicCompactor: { recordStep },
      persistCurrentState: vi.fn(async () => {}),
      settings: DEFAULT_APP_SETTINGS,
      sessionId: 'session-1',
      stepCount: 1,
      maxStepsLabel: '50',
    } as unknown as UpdatePlanToolContext

    await handleUpdatePlanTool(context)

    expect(goalPlanner.findMilestone('m-1')?.status).toBe('in_progress')
    expect(recordStep.mock.calls[0]?.[1]).toContain('file on disk is not verification evidence')
  })

  it('refuses lint as the only proof when a TypeScript check is available', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-lint-proof-'))
    try {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', lint: 'eslint .' } }))
      fs.writeFileSync(path.join(workspacePath, 'tsconfig.json'), '{}')
      fs.mkdirSync(path.join(workspacePath, 'node_modules', 'typescript', 'bin'), { recursive: true })
      fs.writeFileSync(path.join(workspacePath, 'node_modules', 'typescript', 'bin', 'tsc'), '')
      const goalPlanner = new GoalDecompositionPlanner()
      goalPlanner.initializePlan([{ id: 'm-1', title: 'Set up routes', status: 'in_progress', verificationCommand: 'npm run lint' }])
      const recordStep = vi.fn()
      await handleUpdatePlanTool({
        parsedTool: { tool: 'update_plan', parameters: { milestoneId: 'm-1', status: 'verified' } },
        goalPlanner,
        workspacePath,
        emitLog: vi.fn(),
        emitStepUpdate: vi.fn(),
        episodicCompactor: { recordStep } as never,
        persistCurrentState: vi.fn(async () => {}),
        settings: DEFAULT_APP_SETTINGS,
        sessionId: 'session-1',
        stepCount: 1,
        maxStepsLabel: '50',
      } as UpdatePlanToolContext)
      expect(goalPlanner.findMilestone('m-1')?.status).toBe('in_progress')
      expect(recordStep.mock.calls[0]?.[1]).toContain('Lint alone is insufficient')
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
