import { describe, expect, it, vi } from 'vitest'
import { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import { DEFAULT_APP_SETTINGS } from '../../../shared/domain/settings/appSettingsDefaults'
import { agentToolExecutorService } from './agentToolExecutorService'
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

  it('promotes milestone without verificationCommand when workspace has a passing primary check', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-primary-proof-'))
    try {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
      fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true })
      fs.writeFileSync(path.join(workspacePath, 'src/App.tsx'), 'export const App = () => null\n')
      const goalPlanner = new GoalDecompositionPlanner()
      goalPlanner.initializePlan([{ id: 'm-1', title: 'Create App.tsx', filePaths: ['src/App.tsx'], status: 'in_progress' }])
      const mockShell = { execute: vi.fn(async () => ({ code: 0, stdout: 'Build success', stderr: '', timedOut: false })) }
      vi.spyOn(agentToolExecutorService, 'getOrCreateShellSession').mockReturnValue(mockShell as never)

      await handleUpdatePlanTool({
        parsedTool: { tool: 'update_plan', parameters: { milestoneId: 'm-1', status: 'verified' } },
        goalPlanner,
        workspacePath,
        emitLog: vi.fn(),
        emitStepUpdate: vi.fn(),
        episodicCompactor: { recordStep: vi.fn() } as never,
        persistCurrentState: vi.fn(async () => {}),
        settings: { ...DEFAULT_APP_SETTINGS, fullAccess: true },
        sessionId: 'session-1',
        stepCount: 1,
        maxStepsLabel: '50',
      } as UpdatePlanToolContext)

      expect(mockShell.execute).toHaveBeenCalledWith('npm run build', expect.any(Function), undefined, 60000, undefined)
      expect(goalPlanner.findMilestone('m-1')?.status).toBe('verified')
      expect(goalPlanner.findMilestone('m-1')?.verificationEvidence?.command).toBe('npm run build')
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('keeps a styling milestone open when a build passes without a runnable browser preview', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-visual-proof-'))
    try {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
      fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true })
      fs.writeFileSync(path.join(workspacePath, 'src/styles.css'), 'body { margin: 0 }\n')
      const goalPlanner = new GoalDecompositionPlanner()
      goalPlanner.initializePlan([
        { id: 'm-1', title: 'Configure Tailwind CSS', filePaths: ['src/styles.css'], status: 'in_progress', verificationCommand: 'npm run build' },
      ])
      vi.spyOn(agentToolExecutorService, 'getOrCreateShellSession').mockReturnValue({
        execute: vi.fn(async () => ({ code: 0, stdout: '', stderr: '', timedOut: false })),
      } as never)
      const recordStep = vi.fn()
      await handleUpdatePlanTool({
        parsedTool: { tool: 'update_plan', parameters: { milestoneId: 'm-1', status: 'verified' } },
        goalPlanner,
        workspacePath,
        emitLog: vi.fn(),
        emitStepUpdate: vi.fn(),
        episodicCompactor: { recordStep } as never,
        persistCurrentState: vi.fn(async () => {}),
        settings: { ...DEFAULT_APP_SETTINGS, fullAccess: true },
        sessionId: 'session-1',
        stepCount: 1,
        maxStepsLabel: '50',
      } as UpdatePlanToolContext)
      expect(goalPlanner.findMilestone('m-1')?.status).toBe('in_progress')
      expect(recordStep.mock.calls[0]?.[1]).toContain('Browser verification did not pass')
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

  it('rejects update with VERIFICATION FAILED when verification command fails, even if files exist on disk', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-failing-verify-'))
    try {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
      fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true })
      fs.writeFileSync(path.join(workspacePath, 'src/App.tsx'), 'export const App = () => null\n')
      const goalPlanner = new GoalDecompositionPlanner()
      goalPlanner.initializePlan([
        { id: 'm-1', title: 'Create App.tsx', filePaths: ['src/App.tsx'], status: 'in_progress', verificationCommand: 'npm run build' },
      ])
      const mockShell = {
        execute: vi.fn(async () => ({
          code: 1,
          stdout: '',
          stderr: 'Failed to load PostCSS config: Error: module is not defined in ES module scope',
          timedOut: false,
        })),
      }
      vi.spyOn(agentToolExecutorService, 'getOrCreateShellSession').mockReturnValue(mockShell as never)
      const recordStep = vi.fn()

      await handleUpdatePlanTool({
        parsedTool: { tool: 'update_plan', parameters: { milestoneId: 'm-1', status: 'verified' } },
        goalPlanner,
        workspacePath,
        emitLog: vi.fn(),
        emitStepUpdate: vi.fn(),
        episodicCompactor: { recordStep } as never,
        persistCurrentState: vi.fn(async () => {}),
        settings: { ...DEFAULT_APP_SETTINGS, fullAccess: true },
        sessionId: 'session-1',
        stepCount: 1,
        maxStepsLabel: '50',
      } as UpdatePlanToolContext)

      expect(goalPlanner.findMilestone('m-1')?.status).toBe('in_progress')
      const feedback = recordStep.mock.calls[0]?.[1] as string
      expect(feedback).toContain('[UPDATE_PLAN REJECTED: VERIFICATION FAILED]')
      expect(feedback).toContain('module is not defined in ES module scope')
      expect(feedback).not.toContain('CONTRADICTED BY THE WORKSPACE')
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('passes package export diagnostics to the model when update_plan runs a failing build', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-package-export-proof-'))
    try {
      fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ scripts: { build: 'react-scripts build' } }))
      fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true })
      fs.writeFileSync(path.join(workspacePath, 'src/App.js'), "import 'tailwindcss/tailwind.css'\n")
      const goalPlanner = new GoalDecompositionPlanner()
      goalPlanner.initializePlan([
        { id: 'm-1', title: 'Create App.js', filePaths: ['src/App.js'], status: 'in_progress', verificationCommand: 'npm run build' },
      ])
      const mockShell = {
        execute: vi.fn(async () => ({
          code: 1,
          stdout: '',
          stderr: `Module not found: Error: "./tailwind.css" is not exported under the conditions ["import","webpack"] from package ${path.join(workspacePath, 'node_modules', 'tailwindcss')}`,
          timedOut: false,
        })),
      }
      vi.spyOn(agentToolExecutorService, 'getOrCreateShellSession').mockReturnValue(mockShell as never)
      const recordStep = vi.fn()
      await handleUpdatePlanTool({
        parsedTool: { tool: 'update_plan', parameters: { milestoneId: 'm-1', status: 'verified' } },
        goalPlanner,
        workspacePath,
        emitLog: vi.fn(),
        emitStepUpdate: vi.fn(),
        episodicCompactor: { recordStep } as never,
        persistCurrentState: vi.fn(async () => {}),
        settings: { ...DEFAULT_APP_SETTINGS, fullAccess: true },
        sessionId: 'session-1',
        stepCount: 1,
        maxStepsLabel: '50',
      } as UpdatePlanToolContext)

      const feedback = recordStep.mock.calls[0]?.[1] as string
      expect(feedback).toContain('[UPDATE_PLAN REJECTED: VERIFICATION FAILED]')
      expect(feedback).toContain('Suggested fix (advice;')
      expect(feedback).toContain('grep_search" with query "tailwindcss/tailwind.css"')
      expect(goalPlanner.findMilestone('m-1')?.status).toBe('in_progress')
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })
})
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
