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
    expect(prompt).toContain('[x] **Inspect workspace files**')
    expect(prompt).toContain('[>] **Implement feature in main.ts**')
    expect(prompt).toContain('[ ] **Run verification tests**')
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
})
