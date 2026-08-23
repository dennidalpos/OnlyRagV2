import { describe, expect, it } from 'vitest'
import { abandonedMilestoneNote, isSystemAbandoned, resolveMilestoneUpdate } from './milestoneUpdateAuthority'
import type { PlanMilestone } from './planAndSolveGraph'

function milestone(status: PlanMilestone['status'], notes?: string): PlanMilestone {
  return { id: 'm-5', title: 'Create src/pages/Tasks.tsx', status, notes }
}

describe('resolveMilestoneUpdate', () => {
  it('applies an ordinary forward transition', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('pending'),
      requestedStatus: 'in_progress',
      deliverableStatus: 'unsatisfied',
    })

    expect(verdict).toEqual({ kind: 'apply', status: 'in_progress', notes: undefined })
  })

  it('carries the model-supplied notes through on an applied update', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('in_progress'),
      requestedStatus: 'verified',
      requestedNotes: 'Routing wired and rendered',
      deliverableStatus: 'satisfied',
    })

    expect(verdict).toEqual({ kind: 'apply', status: 'verified', notes: 'Routing wired and rendered' })
  })

  it('refuses a no-op update that would burn a step', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('in_progress'),
      requestedStatus: 'in_progress',
      deliverableStatus: 'unsatisfied',
    })

    expect(verdict.kind).toBe('reject')
    if (verdict.kind !== 'reject') throw new Error('expected reject')
    expect(verdict.directive).toContain('NO-OP')
  })

  it('refuses to demote a verified milestone back to in_progress', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('verified', 'Auto-verified: every file named by this milestone exists on disk with content.'),
      requestedStatus: 'in_progress',
      deliverableStatus: 'satisfied',
    })

    expect(verdict.kind).toBe('reject')
    if (verdict.kind !== 'reject') throw new Error('expected reject')
    expect(verdict.directive).toContain('ALREADY VERIFIED')
  })

  it('refuses to fail a verified milestone', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('verified'),
      requestedStatus: 'failed',
      deliverableStatus: 'unsatisfied',
    })

    expect(verdict.kind).toBe('reject')
  })

  it('refuses a failed status while the deliverables exist on disk', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('in_progress'),
      requestedStatus: 'failed',
      requestedNotes: 'Loop / Oscillation Trap Detected (3 repeats, Stagnation: 1)',
      deliverableStatus: 'satisfied',
    })

    expect(verdict.kind).toBe('reject')
    if (verdict.kind !== 'reject') throw new Error('expected reject')
    expect(verdict.directive).toContain('CONTRADICTED BY THE WORKSPACE')
  })

  it('allows a genuine failure when the deliverables are missing', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('in_progress'),
      requestedStatus: 'failed',
      requestedNotes: 'Vite refused to scaffold',
      deliverableStatus: 'unsatisfied',
    })

    expect(verdict).toEqual({ kind: 'apply', status: 'failed', notes: 'Vite refused to scaffold' })
  })

  it('allows a failure on a milestone that names no deliverable to contradict it', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('in_progress'),
      requestedStatus: 'failed',
      deliverableStatus: 'not_applicable',
    })

    expect(verdict.kind).toBe('apply')
  })
})

describe('a milestone the loop guard abandoned', () => {
  // m-6 of session-1787497654743-4enx was abandoned at step 41 with "stop working on it
  // entirely" and reported VERIFIED at step 47. Abandonment exists to break a loop; letting
  // the model write over it undoes the escape and puts the false progress back in the plan.
  const abandoned = milestone('failed', abandonedMilestoneNote(2, 'src/styles/globals.css'))

  it('cannot be reopened as verified', () => {
    const verdict = resolveMilestoneUpdate({
      current: abandoned,
      requestedStatus: 'verified',
      deliverableStatus: 'satisfied',
    })

    expect(verdict.kind).toBe('reject')
    expect(verdict.kind === 'reject' && verdict.directive).toContain('ABANDONED')
  })

  it('cannot be reopened as in_progress either', () => {
    const verdict = resolveMilestoneUpdate({
      current: abandoned,
      requestedStatus: 'in_progress',
      deliverableStatus: 'satisfied',
    })

    expect(verdict.kind).toBe('reject')
  })

  it('is recognised only by the note the guard writes', () => {
    expect(isSystemAbandoned(abandoned)).toBe(true)
    expect(isSystemAbandoned(milestone('failed', 'Verification command failed (exit 1): npm run build'))).toBe(false)
    expect(isSystemAbandoned(milestone('in_progress', abandonedMilestoneNote(2, 'x')))).toBe(false)
  })

  it('leaves a milestone that merely failed its check recoverable', () => {
    const verdict = resolveMilestoneUpdate({
      current: milestone('failed', 'Verification command failed (exit 1): npm run build'),
      requestedStatus: 'verified',
      deliverableStatus: 'satisfied',
    })

    expect(verdict.kind).toBe('apply')
  })
})
