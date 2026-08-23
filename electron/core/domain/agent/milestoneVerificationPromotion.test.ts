import { describe, it, expect } from 'vitest'
import { selectMilestonesProvenByVerification } from './milestoneVerificationPromotion'
import type { PlanMilestone } from './planAndSolveGraph'
import type { MilestoneDeliverableStatus } from './milestoneDeliverableResolver'

function milestone(id: string, title: string, status: PlanMilestone['status'] = 'pending'): PlanMilestone {
  return { id, title, status }
}

/** Deliverable status keyed by milestone id, defaulting to satisfied. */
function statusMap(overrides: Record<string, MilestoneDeliverableStatus> = {}) {
  return (m: PlanMilestone): MilestoneDeliverableStatus => overrides[m.id] ?? 'satisfied'
}

describe('selectMilestonesProvenByVerification', () => {
  it('promotes every milestone whose deliverables are on disk, not just the active one', () => {
    // The o3tx shape: a run of file-creation milestones, all written before anything verified.
    const plan = [
      milestone('m-1', 'Create `package.json`', 'in_progress'),
      milestone('m-2', 'Create `vite.config.ts`', 'in_progress'),
      milestone('m-3', 'Create `src/App.tsx`', 'pending'),
    ]
    expect(selectMilestonesProvenByVerification(plan, statusMap()).map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3'])
  })

  it('leaves alone a milestone that is already verified', () => {
    const plan = [milestone('m-1', 'Create `a.ts`', 'verified'), milestone('m-2', 'Create `b.ts`')]
    expect(selectMilestonesProvenByVerification(plan, statusMap()).map((m) => m.id)).toEqual(['m-2'])
  })

  it('does not resurrect a milestone the loop guard abandoned', () => {
    // `failed` means the work genuinely did not happen; a later green build does not undo that.
    const plan = [milestone('m-1', 'Create `a.ts`', 'failed'), milestone('m-2', 'Create `b.ts`')]
    expect(selectMilestonesProvenByVerification(plan, statusMap()).map((m) => m.id)).toEqual(['m-2'])
  })

  it('never promotes the completion milestone, which the finish tool owns', () => {
    const plan = [
      milestone('m-1', 'Create `a.ts`'),
      milestone('m-2', '🛑 Completamento dell ultimo task, riepilogo finale e arresto dell agente (invoke "finish")'),
    ]
    expect(selectMilestonesProvenByVerification(plan, statusMap()).map((m) => m.id)).toEqual(['m-1'])
  })

  it('never promotes a milestone that names no artefact', () => {
    // The nkn0 lesson: nothing the build compiled can speak for "ensure buttons are 44x44 px",
    // so closing it on a passing build would fabricate verification all over again.
    const plan = [milestone('m-1', 'Ensure buttons have a minimum touch target of 44x44 px'), milestone('m-2', 'Create `a.ts`')]
    const proven = selectMilestonesProvenByVerification(plan, statusMap({ 'm-1': 'not_applicable' }))
    expect(proven.map((m) => m.id)).toEqual(['m-2'])
  })

  it('never promotes a milestone whose files are missing or are placeholders', () => {
    const plan = [milestone('m-1', 'Create `a.ts`'), milestone('m-2', 'Create `b.ts`')]
    const proven = selectMilestonesProvenByVerification(plan, statusMap({ 'm-1': 'unsatisfied' }))
    expect(proven.map((m) => m.id)).toEqual(['m-2'])
  })

  it('promotes nothing when the plan is empty', () => {
    expect(selectMilestonesProvenByVerification([], statusMap())).toEqual([])
  })
})
