import { describe, it, expect } from 'vitest'
import { ensureRunnableMilestone } from './planCompilation'
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
