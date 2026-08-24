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

  describe('verified is refused while a declared deliverable is missing', () => {
    it('names the files that are not there', () => {
      // m-2 of session-1787562597025-q8a5: promoted on a passing check with tsconfig.json
      // never written, which is why `tsc && vite build` could not run for the rest of the run.
      const verdict = resolveMilestoneUpdate({
        current: { id: 'm-2', title: 'Create `vite.config.ts`; Create `tsconfig.json`', status: 'in_progress' },
        requestedStatus: 'verified',
        deliverableStatus: 'unsatisfied',
        unsatisfiedDeliverables: ['tsconfig.json'],
      })

      expect(verdict.kind).toBe('reject')
      if (verdict.kind === 'reject') {
        expect(verdict.directive).toContain('tsconfig.json')
        expect(verdict.directive).toContain('DELIVERABLES MISSING')
      }
    })

    it('falls back to a generic refusal when the caller cannot itemise', () => {
      const verdict = resolveMilestoneUpdate({
        current: milestone('in_progress'),
        requestedStatus: 'verified',
        deliverableStatus: 'unsatisfied',
      })

      expect(verdict.kind).toBe('reject')
    })

    it('still lets a milestone that names no file at all be verified by its command', () => {
      // "Implement responsive navigation" has no artefact to contradict it either way.
      const verdict = resolveMilestoneUpdate({
        current: { id: 'm-9', title: 'Implement responsive navigation', status: 'in_progress' },
        requestedStatus: 'verified',
        deliverableStatus: 'not_applicable',
      })

      expect(verdict.kind).toBe('apply')
    })

    it('does not block the other statuses when deliverables are missing', () => {
      for (const requestedStatus of ['in_progress', 'failed'] as const) {
        expect(
          resolveMilestoneUpdate({
            current: milestone('pending'),
            requestedStatus,
            deliverableStatus: 'unsatisfied',
          }).kind
        ).toBe('apply')
      }
    })
  })
})
