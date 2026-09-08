import { describe, it, expect } from 'vitest'
import {
  compilePlanMilestones,
  ensureScaffoldMilestones,
  ensureRunnableMilestone,
  renderAgentPlanMarkdown,
} from '../../../../shared/domain/agent/planCompilation'

describe('ensureScaffoldMilestones', () => {
  const web = {
    isGreenfield: true,
    requirements: [
      { path: 'package.json', title: 'Declare web project', proposedVerificationCommand: 'npm run build' },
      { path: 'index.html', title: 'Create root page' },
      { path: 'src/main.tsx', title: 'Create React entry' },
    ],
  }
  const pagePlan = [
    { id: 'm-1', title: 'The Dashboard page shows the totals — `src/pages/DashboardPage.tsx`', status: 'pending' as const },
    { id: 'm-2', title: 'Navigation between the pages works — `src/App.tsx`', status: 'pending' as const },
  ]

  it('prepends only missing requirements from the accepted stack', () => {
    const plan = ensureScaffoldMilestones(pagePlan, web)

    expect(plan).toHaveLength(5)
    expect(plan.slice(0, 3).map((m) => m.title)).toEqual([
      expect.stringContaining('`package.json`'),
      expect.stringContaining('`index.html`'),
      expect.stringContaining('`src/main.tsx`'),
    ])
    expect(plan[0].proposedVerificationCommand).toBe('npm run build')
    expect(plan[0].verificationCommand).toBeUndefined()
    expect(plan.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-4', 'm-5'])
  })

  it('adds only what the plan is missing', () => {
    const withEntry = [
      { id: 'm-1', title: 'The entry script mounts the app — `src/main.tsx`', status: 'pending' as const },
      ...pagePlan,
    ]

    const plan = ensureScaffoldMilestones(withEntry, web)

    expect(plan).toHaveLength(5)
    expect(plan.filter((m) => m.title.includes('`src/main.tsx`'))).toHaveLength(1)
    expect(plan[0].title).toContain('`package.json`')
    expect(plan[1].title).toContain('`index.html`')
  })

  it('stays out for existing or unresolved workspaces', () => {
    expect(ensureScaffoldMilestones(pagePlan, { isGreenfield: false, requirements: web.requirements })).toEqual(pagePlan)
    expect(ensureScaffoldMilestones(pagePlan, { isGreenfield: true, requirements: [] })).toEqual(pagePlan)
    expect(ensureScaffoldMilestones(pagePlan, null)).toEqual(pagePlan)
  })
})
describe('ensureRunnableMilestone', () => {
  const files = [
    { id: 'm-1', title: 'Create `package.json`', status: 'pending' as const },
    { id: 'm-2', title: 'Create `src/App.tsx`', status: 'pending' as const },
  ]

  it('appends the milestone a file-shaped plan can never contain', () => {
    // Measured 2026-08-25: 14/15 verified, every deliverable present, and `vite build` emitting
    // no JavaScript. Nothing in the plan was about the application working.
    const plan = ensureRunnableMilestone(files, 'npm run build')

    expect(plan).toHaveLength(3)
    expect(plan[2].verificationCommand).toBe('npm run build')
    expect(plan[2].title).toContain('builds and runs')
  })

  it('names no file, so no write can close it', () => {
    const appended = ensureRunnableMilestone(files, 'npm run build')[2]

    expect(appended.title).not.toMatch(/\.[a-z]{2,4}\b/)
  })

  it('invents nothing when the project declares no check', () => {
    expect(ensureRunnableMilestone(files, null)).toEqual(files)
    expect(ensureRunnableMilestone(files, undefined)).toEqual(files)
  })

  it('does not duplicate a check the plan already declares', () => {
    const withCheck = [...files, { id: 'm-3', title: 'Build it', status: 'pending' as const, verificationCommand: 'npm run build' }]

    expect(ensureRunnableMilestone(withCheck, 'npm run build')).toHaveLength(3)
  })

  it('stays before the closing report milestone, which the finish tool owns', () => {
    const withClosing = [...files, { id: 'm-3', title: 'Write the final report and finish', status: 'pending' as const }]
    const plan = ensureRunnableMilestone(withClosing, 'npm run build')

    expect(plan[2].verificationCommand).toBe('npm run build')
    expect(plan[3].title).toContain('final report')
    expect(plan.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-4'])
  })
})

describe('application-owned closure compilation', () => {
  it('derives the review document from structured plan data', () => {
    const markdown = renderAgentPlanMarkdown({
      version: 2,
      objective: 'Ship authentication',
      decisions: [{ id: 'q-1', statement: 'Storage: local', source: 'explicit_user' }],
      retainedEvidence: [{ interventionId: 'm-0', summary: 'Schema verified', verificationReferences: ['npm test'] }],
      milestones: [{
        id: 'm-1',
        title: 'Login works',
        status: 'pending',
        filePaths: ['src/auth.ts'],
        acceptanceCriteria: ['Valid credentials create a session'],
      }],
      supersededWork: [{ interventionId: 'm-old', reason: 'Replaced by the new endpoint.' }],
    })

    expect(markdown).toContain('## Objective\nShip authentication')
    expect(markdown).toContain('`src/auth.ts`')
    expect(markdown).toContain('Valid credentials create a session')
    expect(markdown).toContain('## Retained evidence')
    expect(markdown).toContain('## Superseded work')
  })

  it('drops a synthetic finish milestone from new canonical plans', () => {
    const plan = compilePlanMilestones([
      { id: 'm-1', title: 'Create `src/app.ts`', status: 'pending' },
      { id: 'm-2', title: 'Write the final report and invoke finish', status: 'pending' },
    ])

    expect(plan).toHaveLength(1)
    expect(plan[0].title).toContain('src/app.ts')
  })

  it('preserves every intervention identity and verification command beyond fifteen entries', () => {
    const source = Array.from({ length: 18 }, (_, index) => ({
      id: `m-${index + 1}`,
      title: `Capability ${index + 1} — \`src/file-${index + 1}.ts\``,
      status: 'pending' as const,
      verificationCommand: `npm run check-${index + 1}`,
    }))

    const compiled = compilePlanMilestones(source)

    expect(compiled).toHaveLength(source.length)
    expect(compiled.map((milestone) => milestone.id)).toEqual(source.map((milestone) => milestone.id))
    expect(compiled.map((milestone) => milestone.verificationCommand)).toEqual(
      source.map((milestone) => milestone.verificationCommand)
    )
  })
})
