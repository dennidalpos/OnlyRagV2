import { describe, it, expect } from 'vitest'
import { GoalDecompositionPlanner, PlanMilestone } from './planAndSolveGraph'

describe('GoalDecompositionPlanner Unit Tests', () => {
  it('should initialize and compile progress prompt correctly', () => {
    const planner = new GoalDecompositionPlanner()
    const milestones: PlanMilestone[] = [
      { id: 'm-1', title: 'Inspect workspace files', status: 'verified', falsifiableHypothesis: 'Config files exist' },
      { id: 'm-2', title: 'Implement feature in main.ts', status: 'in_progress' },
      { id: 'm-3', title: 'Run verification tests', status: 'pending', verificationCommand: 'npm test' },
    ]

    planner.initializePlan(milestones)
    expect(planner.hasPlan()).toBe(true)

    const summary = planner.getProgressSummary()
    expect(summary.completed).toBe(1)
    expect(summary.total).toBe(3)
    expect(summary.percentage).toBe(33)

    const prompt = planner.compileProgressPrompt()
    expect(prompt).toContain('1/3 verified - 33%')
    expect(prompt).toContain('[x] **m-1: Inspect workspace files**')
    expect(prompt).toContain('[>] **m-2: Implement feature in main.ts**')
    expect(prompt).toContain('[ ] **m-3: Run verification tests**')
    expect(prompt).toContain('[CURRENT ACTIVE MICRO-TASK FOCUS]')
    expect(prompt).toContain('Implement feature in main.ts')
  })

  it('orders an unambiguous finish when only the closing milestone remains, never a contradiction', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      { id: 'm-1', title: 'Create src/App.tsx', status: 'verified' },
      { id: 'm-2', title: 'Create src/pages/Tasks.tsx', status: 'failed' },
      { id: 'm-3', title: 'Riepilogo finale e arresto (invoke finish)', status: 'pending' },
    ])

    const prompt = planner.compileProgressPrompt()

    expect(prompt).toContain('[NO OPERATIONAL MILESTONES REMAIN - ACTION REQUIRED]')
    // The contradiction that killed session-1787471833056-o5fk: ordering finish and
    // forbidding it in the same prompt left the model with no legal move.
    expect(prompt).not.toContain('Do NOT invoke \"finish\"')
    expect(prompt).not.toContain('[CURRENT ACTIVE MICRO-TASK FOCUS]')
  })

  it('lists abandoned milestones so the final report can own them', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      { id: 'm-1', title: 'Create src/pages/Tasks.tsx', status: 'failed' },
      { id: 'm-2', title: 'Completamento e arresto (invoke finish)', status: 'pending' },
    ])

    const prompt = planner.compileProgressPrompt()

    expect(prompt).toContain('MUST be reported as incomplete in your summary')
    expect(prompt).toContain('- m-1: Create src/pages/Tasks.tsx')
  })

  it('keeps the ordinary focus block while operational work is still pending', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      { id: 'm-1', title: 'Create src/App.tsx', status: 'failed' },
      { id: 'm-2', title: 'Create src/pages/Tasks.tsx', status: 'pending' },
      { id: 'm-3', title: 'Riepilogo finale (invoke finish)', status: 'pending' },
    ])

    const prompt = planner.compileProgressPrompt()

    expect(prompt).toContain('[CURRENT ACTIVE MICRO-TASK FOCUS]')
    expect(prompt).toContain('Task m-2: Create src/pages/Tasks.tsx')
    expect(prompt).not.toContain('[NO OPERATIONAL MILESTONES REMAIN')
  })

  it('should parse markdown checklist plans from LLM text', () => {
    const rawOutput = `
Here is my plan to solve the task:
- [x] Step 1: Read App.tsx
- [>] Step 2: Add dark mode toggle
- [ ] Step 3: Verify with npm test
`
    const parsed = GoalDecompositionPlanner.parsePlanFromText(rawOutput)
    expect(parsed.length).toBe(3)
    expect(parsed[0].status).toBe('verified')
    expect(parsed[0].title).toBe('Step 1: Read App.tsx')
    expect(parsed[1].status).toBe('in_progress')
    expect(parsed[2].status).toBe('pending')
  })

  it('should parse structured JSON plan from <plan> blocks', () => {
    const rawOutput = `
<plan>
[
  { "id": "m1", "title": "Setup db table", "status": "pending", "verificationCommand": "pytest tests/test_db.py" },
  { "id": "m2", "title": "Create REST endpoint", "status": "pending" }
]
</plan>
`
    const parsed = GoalDecompositionPlanner.parsePlanFromText(rawOutput)
    expect(parsed.length).toBe(2)
    expect(parsed[0].title).toBe('Setup db table')
    expect(parsed[0].verificationCommand).toBe('pytest tests/test_db.py')
  })

  it('should update milestone status and detect when all milestones are verified', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      { id: 'm-1', title: 'Task A', status: 'pending' },
      { id: 'm-2', title: 'Task B', status: 'pending' },
    ])

    expect(planner.isAllVerified()).toBe(false)
    planner.updateMilestone('m-1', 'verified')
    expect(planner.isAllVerified()).toBe(false)

    planner.updateMilestone('m-2', 'verified')
    expect(planner.isAllVerified()).toBe(true)
    expect(planner.getProgressSummary().percentage).toBe(100)
  })
  it('should carry verified and failed milestones over when the plan is replaced mid-session', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      { id: 'm-1', title: 'Scaffold project', status: 'pending' },
      { id: 'm-2', title: 'Add routing', status: 'pending' },
      { id: 'm-3', title: 'Write tests', status: 'pending' },
    ])
    planner.updateMilestone('m-1', 'verified')
    planner.updateMilestone('m-2', 'failed')

    planner.replacePlanPreservingProgress([
      { id: 'r-1', title: 'Scaffold project', status: 'pending' },
      { id: 'r-2', title: 'Add routing', status: 'pending' },
      { id: 'r-3', title: 'Add state management', status: 'pending' },
    ])

    const milestones = planner.getMilestones()
    expect(milestones.length).toBe(3)
    expect(milestones[0].status).toBe('verified')
    expect(milestones[1].status).toBe('failed')
    // A genuinely new milestone starts fresh rather than inheriting anything.
    expect(milestones[2].title).toBe('Add state management')
    expect(milestones[2].status).toBe('pending')
    expect(planner.getProgressSummary().completed).toBe(1)
  })

  it('should compute compact state directly from milestones', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      { id: 'm-1', title: 'Create auth types', status: 'pending' },
      { id: 'm-2', title: 'Configure JWT middleware', status: 'verified' },
    ])

    const compactState = planner.getCompactState('Add Authentication Feature')
    expect(compactState.objective).toBe('Add Authentication Feature')
    expect(compactState.restorePoint).toBe('m-2: Configure JWT middleware')
    expect(compactState.activeMicroTask).toBe('m-1: Create auth types')
    expect(compactState.pendingMicroTasks).toHaveLength(1)
    expect(compactState.pendingMicroTasks[0]).toBe('m-1: Create auth types')
    expect(compactState.completedCount).toBe(1)
    expect(compactState.totalCount).toBe(2)
    expect(compactState.isCompleted).toBe(false)
  })

  it('should mark plan as completed when every milestone is verified', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      { id: 'm-1', title: 'Task 1', status: 'verified' },
      { id: 'm-2', title: 'Task 2', status: 'verified' },
    ])
    const compactState = planner.getCompactState()

    expect(compactState.isCompleted).toBe(true)
    expect(compactState.pendingMicroTasks).toHaveLength(0)
    expect(compactState.activeMicroTask).toBe('None (Plan Completed)')
  })

  it('should handle an empty milestone list in compact state', () => {
    const planner = new GoalDecompositionPlanner()
    const compactState = planner.getCompactState('Empty Objective')

    expect(compactState.totalCount).toBe(0)
    expect(compactState.completedCount).toBe(0)
    expect(compactState.isCompleted).toBe(false)
    expect(compactState.restorePoint).toBe('None (Session Initialized)')
  })

  it('should flatten indented sub-bullets into discrete atomic microtasks', () => {
    const rawOutput = `
Here is the microtask execution plan:
- [ ] 📦 Step 1: Scaffolding & Setup
  - Initialize project with package.json
  - Install tailwindcss and vite dependencies
- [ ] 📐 Step 2: Architecture & Foundation
  - Create src/App.tsx layout shell
  - Create src/components/Sidebar.tsx navigation
  - Create src/pages/Dashboard.tsx
- [ ] 🧪 Step 3: Verification
  - [ ] Run npm run build
  - [ ] Run tsc --noEmit
`
    const parsed = GoalDecompositionPlanner.parsePlanFromText(rawOutput)
    expect(parsed.length).toBe(7)
    expect(parsed[0].id).toBe('m-1')
    expect(parsed[0].title).toBe('Initialize project with package.json')
    expect(parsed[1].id).toBe('m-2')
    expect(parsed[1].title).toBe('Install tailwindcss and vite dependencies')
    expect(parsed[2].id).toBe('m-3')
    expect(parsed[2].title).toBe('Create src/App.tsx layout shell')
    expect(parsed[3].id).toBe('m-4')
    expect(parsed[3].title).toBe('Create src/components/Sidebar.tsx navigation')
    expect(parsed[4].id).toBe('m-5')
    expect(parsed[4].title).toBe('Create src/pages/Dashboard.tsx')
    expect(parsed[5].id).toBe('m-6')
    expect(parsed[5].title).toBe('Run npm run build')
    expect(parsed[6].id).toBe('m-7')
    expect(parsed[6].title).toBe('Run tsc --noEmit')
  })

  it('should parse checklist plans wrapped inside markdown code blocks without skipping them', () => {
    const rawFencedPlan = '```markdown\n' +
      '- [ ] 1-1: Create a new React project using `npx create-react-app ProjectDashboardTask`\n' +
      '- [ ] 1-2: Install Tailwind CSS\n' +
      '- [ ] 1-3: Create src/pages/Dashboard.tsx\n' +
      '- [ ] 1-4: Create src/pages/Tasks.tsx\n' +
      '```\n' +
      '22. 🛑 Completamento dell\'ultimo task, riepilogo finale e arresto dell\'agente (invoke "finish")'

    const parsed = GoalDecompositionPlanner.parsePlanFromText(rawFencedPlan)
    expect(parsed.length).toBe(5)
    expect(parsed[0].id).toBe('m-1')
    expect(parsed[0].title).toContain('Create a new React project')
    expect(parsed[1].id).toBe('m-2')
    expect(parsed[1].title).toContain('Install Tailwind CSS')
    expect(parsed[2].id).toBe('m-3')
    expect(parsed[2].title).toContain('Dashboard.tsx')
    expect(parsed[3].id).toBe('m-4')
    expect(parsed[3].title).toContain('Tasks.tsx')
    expect(parsed[4].id).toBe('m-5')
    expect(parsed[4].title).toContain('Completamento dell\'ultimo task')
  })

  it('should not double up the milestone id when the planner model self-labels its titles (regression: "Task m-1: m-1: ...")', () => {
    const rawOutput = `
- [ ] m-1: Create a new React project using Vite.
- [ ] m-2: Initialize Tailwind CSS in the project.
`
    const parsed = GoalDecompositionPlanner.parsePlanFromText(rawOutput)
    expect(parsed[0].title).toBe('Create a new React project using Vite.')
    expect(parsed[1].title).toBe('Initialize Tailwind CSS in the project.')

    const planner = new GoalDecompositionPlanner()
    planner.initializePlan(parsed as any)
    const prompt = planner.compileProgressPrompt()

    expect(prompt).toContain('**m-1: Create a new React project using Vite.**')
    expect(prompt).not.toContain('m-1: m-1:')
    expect(prompt).not.toContain('m-2: m-2:')

    // the tracker re-prefixes the id too, and must likewise render it exactly once
    const compact = planner.getCompactState()
    expect(compact.activeMicroTask).toBe('m-1: Create a new React project using Vite.')
    expect(compact.pendingMicroTasks[1]).toBe('m-2: Initialize Tailwind CSS in the project.')
  })
  describe('verification directives on checklist lines', () => {
    it('reads the verification command from a dash-separated directive and keeps it out of the title', () => {
      const plan = GoalDecompositionPlanner.parsePlanFromText(
        '- [ ] m-1: Create `src/App.tsx` with the layout shell\n' +
        '- [ ] m-2: Verifica di compilazione del progetto — verify: `npm run build`'
      )

      expect(plan).toHaveLength(2)
      expect(plan[0].verificationCommand).toBeUndefined()
      expect(plan[1].title).toBe('Verifica di compilazione del progetto')
      expect(plan[1].verificationCommand).toBe('npm run build')
    })

    it('reads a bracketed directive and accepts the Italian keyword', () => {
      const plan = GoalDecompositionPlanner.parsePlanFromText('- [ ] m-1: Suite di test verde (verifica: `npm test`)')

      expect(plan[0].title).toBe('Suite di test verde')
      expect(plan[0].verificationCommand).toBe('npm test')
    })

    it('reads the directive on flattened sub-bullets too', () => {
      const plan = GoalDecompositionPlanner.parsePlanFromText(
        '- [ ] Quality gate\n' +
        '  - [ ] Typecheck pulito — verify: `npx tsc --noEmit`\n' +
        '  - [ ] Build pulita — verify: `npm run build`'
      )

      expect(plan.map((m) => m.verificationCommand)).toEqual(['npx tsc --noEmit', 'npm run build'])
      expect(plan[0].title).toBe('Typecheck pulito')
    })

    it('leaves a line that merely mentions verification untouched', () => {
      const plan = GoalDecompositionPlanner.parsePlanFromText('- [ ] m-1: Verify the layout renders on tablet widths')

      expect(plan[0].title).toBe('Verify the layout renders on tablet widths')
      expect(plan[0].verificationCommand).toBeUndefined()
    })

    it('keeps the title when the directive would consume the whole line', () => {
      const plan = GoalDecompositionPlanner.parsePlanFromText('- [ ] verify: `npm run build`')

      expect(plan[0].title).toBe('verify: `npm run build`')
      expect(plan[0].verificationCommand).toBeUndefined()
    })
    it('reads back the directive as compileProgressPrompt renders it, emphasis markers included', () => {
      const planner = new GoalDecompositionPlanner()
      planner.initializePlan([
        { id: 'm-1', title: 'Build pulita', status: 'pending', verificationCommand: 'npm run build' },
      ])

      // The model sees this rendering every turn and mimics it when it revises the plan,
      // so the parser has to accept its own output back.
      const reparsed = GoalDecompositionPlanner.parsePlanFromText(planner.compileProgressPrompt())

      expect(reparsed[0].title).toBe('Build pulita')
      expect(reparsed[0].verificationCommand).toBe('npm run build')
    })
  })
})
