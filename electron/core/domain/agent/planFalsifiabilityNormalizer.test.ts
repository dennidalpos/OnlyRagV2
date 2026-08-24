import { describe, expect, it } from 'vitest'
import { isFalsifiableMilestone, normalizePlanFalsifiability } from './planFalsifiabilityNormalizer'
import type { PlanMilestone } from './planAndSolveGraph'

function plan(...titles: string[]): PlanMilestone[] {
  return titles.map((title, idx) => ({ id: `m-${idx + 1}`, title, status: 'pending' as const }))
}

describe('isFalsifiableMilestone', () => {
  it('accepts a milestone naming a file', () => {
    expect(isFalsifiableMilestone({ id: 'm-1', title: 'Create src/App.tsx', status: 'pending' })).toBe(true)
  })

  it('accepts a milestone carrying a verification command', () => {
    expect(
      isFalsifiableMilestone({ id: 'm-1', title: 'Make the build pass', status: 'pending', verificationCommand: 'npm run build' })
    ).toBe(true)
  })

  it('accepts the closing milestone, which the finish tool owns', () => {
    expect(isFalsifiableMilestone({ id: 'm-9', title: 'Riepilogo finale e arresto (invoke finish)', status: 'pending' })).toBe(true)
  })

  it('rejects the acceptance criteria that used to masquerade as steps', () => {
    // All three were reported VERIFIED in session-1787476734227-nkn0 without being done.
    expect(isFalsifiableMilestone({ id: 'm-11', title: 'Ensure buttons have a minimum touch target of 44×44 px.', status: 'pending' })).toBe(false)
    expect(isFalsifiableMilestone({ id: 'm-13', title: 'Fix every overflow, clipping, or spacing issue.', status: 'pending' })).toBe(false)
    expect(isFalsifiableMilestone({ id: 'm-14', title: 'Run the application to ensure it is fully runnable.', status: 'pending' })).toBe(false)
  })
})

describe('normalizePlanFalsifiability', () => {
  it('leaves an already falsifiable plan untouched', () => {
    const input = plan('Create src/App.tsx', 'Create src/main.tsx')
    expect(normalizePlanFalsifiability(input)).toBe(input)
  })

  it('returns an empty plan for empty or non-array input', () => {
    expect(normalizePlanFalsifiability([])).toEqual([])
    expect(normalizePlanFalsifiability(undefined as unknown as PlanMilestone[])).toEqual([])
  })

  it('folds a criterion into the deliverable it qualifies', () => {
    const result = normalizePlanFalsifiability(
      plan('Create src/components/Button.tsx', 'Ensure buttons have a minimum touch target of 44×44 px.')
    )

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Create src/components/Button.tsx; Ensure buttons have a minimum touch target of 44×44 px.')
  })

  it('attaches a leading criterion forward to the first real step', () => {
    const result = normalizePlanFalsifiability(plan('Use a mobile-first approach throughout.', 'Create src/App.tsx'))

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Create src/App.tsx; Use a mobile-first approach throughout.')
  })

  it('renumbers the surviving milestones sequentially', () => {
    const result = normalizePlanFalsifiability(
      plan('Create src/App.tsx', 'Fix every overflow issue.', 'Create src/main.tsx', 'Add responsive spacing.')
    )

    expect(result.map((m) => m.id)).toEqual(['m-1', 'm-2'])
  })

  it('never lets the closing milestone absorb implementation criteria', () => {
    const result = normalizePlanFalsifiability(
      plan('Create src/App.tsx', 'Riepilogo finale e arresto (invoke finish)', 'Run the application to check it works.')
    )

    const closing = result[result.length - 1]
    expect(closing.title).toBe('Riepilogo finale e arresto (invoke finish)')
    expect(result[0].title).toContain('Run the application to check it works.')
  })

  it('preserves every requirement across the fold', () => {
    const criteria = ['Never allow horizontal scrolling.', 'Use responsive spacing and typography.']
    const merged = normalizePlanFalsifiability(plan('Create src/App.tsx', ...criteria))
      .map((m) => m.title)
      .join(' ')

    for (const criterion of criteria) expect(merged).toContain(criterion)
  })

  it('leaves a plan with nothing falsifiable in it alone rather than emptying the checklist', () => {
    const input = plan('Design the tablet layout.', 'Polish the spacing.')
    expect(normalizePlanFalsifiability(input)).toBe(input)
  })

  it('consolidates adjacent milestones targeting the exact same deliverable file', () => {
    const input = plan(
      'Create src/styles/globals.css',
      'Add Tailwind directives to src/styles/globals.css',
      'Create src/components/Sidebar.tsx'
    )
    const result = normalizePlanFalsifiability(input)
    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('Create src/styles/globals.css; Add Tailwind directives to src/styles/globals.css')
    expect(result[1].title).toBe('Create src/components/Sidebar.tsx')
  })
})
