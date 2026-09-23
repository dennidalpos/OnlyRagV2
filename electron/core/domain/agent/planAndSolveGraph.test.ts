import { describe, expect, it } from 'vitest'
import { GoalDecompositionPlanner, isCompletionMilestoneTitle, type PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'

describe('isCompletionMilestoneTitle', () => {
  it('recognises only legacy closing milestones without deliverables', () => {
    expect(isCompletionMilestoneTitle('Riepilogo finale e arresto (invoke finish)')).toBe(true)
    expect(isCompletionMilestoneTitle('Write the final report and finish')).toBe(true)
    expect(isCompletionMilestoneTitle('Create src/components/FinishButton.tsx')).toBe(false)
    expect(isCompletionMilestoneTitle({ title: 'Finish the pending work', filePaths: ['src/task.ts'] })).toBe(false)
  })
})

describe('GoalDecompositionPlanner', () => {
  it('initializes canonical milestones and renders the active work', () => {
    const planner = new GoalDecompositionPlanner()
    const milestones: PlanMilestone[] = [
      { id: 'm-1', title: 'Inspect workspace files', status: 'verified', falsifiableHypothesis: 'Config files exist' },
      { id: 'm-2', title: 'Implement feature in main.ts', status: 'in_progress' },
      { id: 'm-3', title: 'Run verification tests', status: 'pending', verificationCommand: 'npm test' },
    ]

    planner.initializePlan(milestones)

    expect(planner.getProgressSummary()).toEqual({ completed: 1, total: 3, percentage: 33 })
    const prompt = planner.compileProgressPrompt()
    expect(prompt).toContain('1/3 verified - 33%')
    expect(prompt).toContain('[>] **m-2: Implement feature in main.ts**')
    expect(prompt).toContain('[CURRENT ACTIVE MICRO-TASK FOCUS]')
  })

  it('emits transitions only when a status changes', () => {
    const planner = new GoalDecompositionPlanner()
    const transitions: string[] = []
    planner.onMilestoneTransition((transition) => transitions.push(`${transition.id}:${transition.from}:${transition.to}`))
    planner.initializePlan([{ id: 'm-1', title: 'Task A', status: 'pending' }])

    planner.updateMilestone('m-1', 'in_progress')
    planner.updateMilestone('m-1', 'in_progress')
    planner.updateMilestone('m-1', 'verified')

    expect(transitions).toEqual(['m-1:pending:in_progress', 'm-1:in_progress:verified'])
    expect(planner.isAllVerified()).toBe(true)
  })

  it('preserves an explicit canonical plan on load and exposes its compact state', () => {
    const planner = new GoalDecompositionPlanner()
    planner.loadMilestones([
      { id: 'm-1', title: 'Create auth types', status: 'pending' },
      { id: 'm-2', title: 'Configure JWT middleware', status: 'verified' },
    ])

    expect(planner.getCompactState('Add Authentication Feature')).toEqual({
      objective: 'Add Authentication Feature',
      restorePoint: 'm-2: Configure JWT middleware',
      activeMicroTask: 'm-1: Create auth types',
      pendingMicroTasks: ['m-1: Create auth types'],
      completedCount: 1,
      totalCount: 2,
      isCompleted: false,
    })
  })

  it('keeps legacy closing milestones out of active work and reports failures', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      { id: 'm-1', title: 'Create src/App.tsx', status: 'verified' },
      { id: 'm-2', title: 'Create src/pages/Tasks.tsx', status: 'failed' },
      { id: 'm-3', title: 'Riepilogo finale e arresto (invoke finish)', status: 'pending' },
    ])

    const prompt = planner.compileProgressPrompt()
    expect(prompt).toContain('[NO OPERATIONAL MILESTONES REMAIN - FINAL REPORT REQUIRED]')
    expect(prompt).toContain('- m-2: Create src/pages/Tasks.tsx')
    expect(prompt).not.toContain('[CURRENT ACTIVE MICRO-TASK FOCUS]')
  })

  it('advances past a verified artifact awaiting later verification', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      {
        id: 'm-1',
        title: 'Create package.json',
        status: 'in_progress',
        notes: 'Awaiting a passing verification command before this can count as verified.',
      },
      { id: 'm-2', title: 'Create src/styles/globals.css', status: 'pending' },
    ])

    expect(planner.getActiveMilestone()?.id).toBe('m-2')
  })

  it('bounds the prompt without changing canonical milestones', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan(
      Array.from({ length: 20 }, (_, index) => ({
        id: `m-${index + 1}`,
        title: `Implement capability ${index + 1} in src/file-${index + 1}.ts`,
        status: 'pending' as const,
      })),
    )

    const prompt = planner.compileProgressPrompt()
    expect(planner.getMilestones()).toHaveLength(20)
    expect(prompt).toContain('**m-1:')
    expect(prompt).not.toContain('**m-16:')
    expect(prompt).toContain('19 later milestones omitted from this turn; retained in canonical state')
  })
})

describe('GoalDecompositionPlanner.remapFilePath', () => {
  // Full task run 2026-09-23: a JSX directive renamed src/App.js -> src/App.jsx, but m-6/m-7 kept
  // naming src/App.js, so they could never be delivered and the run ended 0/7.
  it('moves declared paths, file evidence and path tokens to the renamed file', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      {
        id: 'm-6',
        title: 'Render the list in src/App.js.',
        status: 'verified',
        filePaths: ['src/App.js', 'src/index.js'],
        fileEvidence: { 'src/App.js': 'sha256:aaa', 'src/index.js': 'sha256:bbb' },
        acceptanceCriteria: ['src/App.js renders <TodoList/>'],
        verificationCommand: 'node --check ./src/App.js',
      },
      { id: 'm-7', title: 'Style the header in src/App.js', status: 'pending' },
      { id: 'm-8', title: 'Keep src/App.jsx.bak and lib/src/App.js untouched', status: 'pending', filePaths: ['src/App.jsx.bak'] },
    ])

    expect(planner.remapFilePath('src\\App.js', './src/App.jsx')).toEqual(['m-6', 'm-7'])

    const [m6, m7, m8] = planner.getMilestones()
    expect(m6.filePaths).toEqual(['src/App.jsx', 'src/index.js'])
    expect(m6.fileEvidence).toEqual({ 'src/App.jsx': 'sha256:aaa', 'src/index.js': 'sha256:bbb' })
    expect(m6.title).toBe('Render the list in src/App.jsx.')
    expect(m6.acceptanceCriteria).toEqual(['src/App.jsx renders <TodoList/>'])
    expect(m6.verificationCommand).toBe('node --check ./src/App.jsx')
    expect(m6.status).toBe('verified')
    expect(m7.filePaths).toEqual(['src/App.jsx'])
    expect(m7.title).toBe('Style the header in src/App.jsx')
    expect(m8.title).toBe('Keep src/App.jsx.bak and lib/src/App.js untouched')
    expect(m8.filePaths).toEqual(['src/App.jsx.bak'])
  })

  it('remaps files under a moved directory and ignores no-op moves', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([{ id: 'm-1', title: 'Create components', status: 'pending', filePaths: ['src/components/List.tsx', 'src/main.tsx'] }])

    expect(planner.remapFilePath('src/main.tsx', './src/main.tsx')).toEqual([])
    expect(planner.remapFilePath('src/components/', 'src/ui')).toEqual(['m-1'])
    expect(planner.getMilestones()[0].filePaths).toEqual(['src/ui/List.tsx', 'src/main.tsx'])
  })
})
