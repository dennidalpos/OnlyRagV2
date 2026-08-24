import { describe, it, expect } from 'vitest'
import { assessPostVerificationClosure, buildClosureDirective } from './postVerificationClosure'
import type { PlanMilestone } from './planAndSolveGraph'
import type { MilestoneDeliverableStatus } from './milestoneDeliverableResolver'

function milestone(id: string, title: string, status: PlanMilestone['status'] = 'in_progress'): PlanMilestone {
  return { id, title, status }
}

/** Deliverable status keyed by milestone id, so each case reads as the disk state it means. */
function statusMap(map: Record<string, MilestoneDeliverableStatus>) {
  return (m: PlanMilestone) => map[m.id] || 'not_applicable'
}

describe('assessPostVerificationClosure', () => {
  it('refuses closure while nothing has been verified', () => {
    const result = assessPostVerificationClosure({
      hasVerifiedBuild: false,
      milestones: [milestone('m-1', 'Ensure the buttons are large enough')],
      deliverableStatusOf: statusMap({ 'm-1': 'not_applicable' }),
    })
    expect(result.state).toBe('not_closable')
  })

  it('refuses closure while a milestone still names a file that is missing', () => {
    const result = assessPostVerificationClosure({
      hasVerifiedBuild: true,
      milestones: [
        milestone('m-1', 'Ensure the buttons are large enough'),
        milestone('m-2', 'Create `src/pages/Tasks.tsx`'),
      ],
      deliverableStatusOf: statusMap({ 'm-1': 'not_applicable', 'm-2': 'unsatisfied' }),
    })
    expect(result.state).toBe('not_closable')
    expect(result.unprovable).toEqual([])
  })

  // The deadlock: a green build, and the only thing left is a milestone no command can prove.
  it('names the unprovable milestones once the build is green and nothing else is open', () => {
    const result = assessPostVerificationClosure({
      hasVerifiedBuild: true,
      milestones: [
        milestone('m-1', 'Create `src/App.tsx`', 'verified'),
        milestone('m-2', 'Ensure every button has a 44x44 touch target'),
        milestone('m-3', 'Run the application'),
      ],
      deliverableStatusOf: statusMap({ 'm-2': 'not_applicable', 'm-3': 'not_applicable' }),
    })
    expect(result.state).toBe('close_unprovable_then_finish')
    expect(result.unprovable.map((m) => m.id)).toEqual(['m-2', 'm-3'])
  })

  it('reports finish_now when the green build leaves nothing open at all', () => {
    const result = assessPostVerificationClosure({
      hasVerifiedBuild: true,
      milestones: [milestone('m-1', 'Create `src/App.tsx`', 'verified')],
      deliverableStatusOf: statusMap({}),
    })
    expect(result.state).toBe('finish_now')
  })

  // Abandoned work must not hold the session open: the loop guard gave up on it deliberately,
  // and the final report is where it gets accounted for.
  it('does not let an abandoned milestone block closure', () => {
    const result = assessPostVerificationClosure({
      hasVerifiedBuild: true,
      milestones: [
        milestone('m-1', 'Create `src/App.tsx`', 'verified'),
        milestone('m-2', 'Create `src/pages/Tasks.tsx`', 'failed'),
      ],
      deliverableStatusOf: statusMap({ 'm-2': 'unsatisfied' }),
    })
    expect(result.state).toBe('finish_now')
  })

  it('does not let the completion milestone block closure — the finish tool owns it', () => {
    const result = assessPostVerificationClosure({
      hasVerifiedBuild: true,
      milestones: [
        milestone('m-1', 'Create `src/App.tsx`', 'verified'),
        milestone('m-2', 'Finish and report the results to the user', 'pending'),
      ],
      deliverableStatusOf: statusMap({}),
    })
    expect(result.state).toBe('finish_now')
  })
})

describe('buildClosureDirective', () => {
  it('returns null while the session is not closable, leaving the ordinary prompt untouched', () => {
    expect(buildClosureDirective({ state: 'not_closable', unprovable: [] })).toBeNull()
  })

  it('orders finish directly when nothing is open', () => {
    const directive = buildClosureDirective({ state: 'finish_now', unprovable: [] })!
    expect(directive).toContain('"finish"')
    expect(directive).not.toContain('update_plan')
  })

  it('names each unprovable milestone and the exact two calls that close the session', () => {
    const directive = buildClosureDirective({
      state: 'close_unprovable_then_finish',
      unprovable: [
        { id: 'm-2', title: 'Ensure every button has a 44x44 touch target' },
        { id: 'm-3', title: 'Run the application' },
      ],
    })!
    expect(directive).toContain('m-2: Ensure every button has a 44x44 touch target')
    expect(directive).toContain('m-3: Run the application')
    expect(directive).toContain('update_plan')
    expect(directive).toContain('"finish"')
  })

  // A directive that offers a choice invites the model to delegate it — that is how the first
  // ERESOLVE wording ended a session with `ask` in AGENT mode, where nobody can answer.
  it('gives one sequence rather than options to weigh', () => {
    const directive = buildClosureDirective({
      state: 'close_unprovable_then_finish',
      unprovable: [{ id: 'm-2', title: 'Run the application' }],
    })!
    expect(directive.toLowerCase()).not.toContain('either')
    expect(directive.toLowerCase()).not.toContain('you may')
    expect(directive.toLowerCase()).not.toContain('pick one')
  })

  it('tells the model not to re-run the verification, which is the action it was looping on', () => {
    const directive = buildClosureDirective({
      state: 'close_unprovable_then_finish',
      unprovable: [{ id: 'm-2', title: 'Run the application' }],
    })!
    expect(directive).toContain('do NOT re-run the verification command')
  })
})
