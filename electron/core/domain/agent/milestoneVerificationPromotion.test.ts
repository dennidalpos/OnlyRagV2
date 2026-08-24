import { describe, it, expect } from 'vitest'
import { partialDeliveryDirective, selectMilestonesProvenByVerification } from './milestoneVerificationPromotion'
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

/**
 * live-full-task, 2026-08-24: milestone m-6 was "Configure Tailwind CSS in `postcss.config.js`
 * and `tailwind.config.js`". The model wrote `postcss.config.js` at step 19 and rewrote that
 * same file at steps 20, 21, 22, 23, 25, 27, 28 and 29. `tailwind.config.js` was never written
 * in the whole fifty-step run. The system knew which file was missing at every one of those
 * steps and never said so.
 */
describe('partialDeliveryDirective', () => {
  it('names the missing file, not just the fact that something is missing', () => {
    const directive = partialDeliveryDirective('m-6', 'postcss.config.js', ['tailwind.config.js'])
    expect(directive).toContain('"tailwind.config.js"')
    expect(directive).toContain('m-6')
  })

  // The observed loop WAS re-writing the delivered file. Saying only "write the missing one"
  // leaves that behaviour untouched; naming it as blocked closes it.
  it('tells the model not to rewrite the file it already delivered', () => {
    const directive = partialDeliveryDirective('m-6', 'postcss.config.js', ['tailwind.config.js'])
    expect(directive).toContain('Do NOT re-write "postcss.config.js"')
  })

  it('credits the write that landed rather than reading as a failure', () => {
    const directive = partialDeliveryDirective('m-6', 'postcss.config.js', ['tailwind.config.js'])
    expect(directive).toContain('was written and is accepted')
  })

  it('lists every missing file and agrees with itself on number', () => {
    const directive = partialDeliveryDirective('m-2', 'vite.config.ts', ['tsconfig.json', 'index.html'])
    expect(directive).toContain('"tsconfig.json", "index.html"')
    expect(directive).toContain('2 FILES STILL MISSING')
    expect(directive).toContain('are NOT on disk')
  })

  it('uses the singular for a single missing file', () => {
    const directive = partialDeliveryDirective('m-6', 'postcss.config.js', ['tailwind.config.js'])
    expect(directive).toContain('1 FILE STILL MISSING')
    expect(directive).toContain('is NOT on disk')
  })
})
