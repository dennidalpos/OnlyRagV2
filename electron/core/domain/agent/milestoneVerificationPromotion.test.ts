import { describe, it, expect } from 'vitest'
import { partialDeliveryDirective, redeliveredMilestoneDirective, selectMilestonesProvenByVerification } from './milestoneVerificationPromotion'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { MilestoneDeliverableStatus } from '../../../../shared/domain/agent/milestoneDeliverableResolver'

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
  // leaves that behaviour untouched; the delivered file has to be named as the wrong target.
  it('points the next write away from the file it already delivered', () => {
    const directive = partialDeliveryDirective('m-6', 'postcss.config.js', ['tailwind.config.js'])
    expect(directive).toContain('rather than the file you have already delivered')
    expect(directive).toContain('Write "tailwind.config.js" next')
  })

  it('credits the write that landed rather than reading as a failure', () => {
    const directive = partialDeliveryDirective('m-6', 'postcss.config.js', ['tailwind.config.js'])
    expect(directive).toContain('"postcss.config.js" is on disk with real content')
  })

  /**
   * This text is a tool result, so it is replayed in the history block for as long as it
   * survives trimming, while the plan block is rebuilt from live state every turn. In session
   * live-full-task of 2026-08-25T12:11 the old wording forbade rewriting
   * "src/pages/DashboardPage.tsx" and threatened a block, while the active plan block ordered
   * exactly that rewrite because the file imported a package that does not exist. The model
   * did not touch the file for the whole window the forbidding text survived, and rewrote it
   * fifteen steps after it aged out.
   *
   * So: state what was measured, and nothing else. The probe establishes that a file exists
   * with non-placeholder content — not that its content is correct — and whether a rewrite is
   * blocked belongs to the loop detector, not to this milestone.
   */
  it('claims neither that the delivered file is correct nor that a rewrite will be blocked', () => {
    const directive = partialDeliveryDirective('m-6', 'postcss.config.js', ['tailwind.config.js'])
    expect(directive).not.toContain('already correct')
    expect(directive).not.toContain('blocked as a loop')
    expect(directive).not.toContain('Do NOT re-write')
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

/**
 * The half of the churn the no-op detector and the partial-delivery directive both miss: a
 * REAL rewrite of a milestone that was already complete. Live run of 2026-08-24, `src/main.tsx`
 * written at step 25 and rewritten at 27, 28, 34 and 37 with different content every time —
 * 617, 379, 368, 262 and 529 characters, the shortest of them a literal
 * `// TODO: Implement main application logic` over working code. The model was told
 * `Successfully wrote file` each time and nothing else.
 */
describe('redeliveredMilestoneDirective', () => {
  it('says the milestone was already complete and that the rewrite moved nothing', () => {
    const directive = redeliveredMilestoneDirective('m-5', 'src/main.tsx', null)

    expect(directive).toContain('MILESTONE m-5 WAS ALREADY COMPLETE')
    expect(directive).toContain('src/main.tsx')
    expect(directive).toContain('cannot advance the plan')
  })

  it('names the file the active milestone is actually waiting for', () => {
    const directive = redeliveredMilestoneDirective('m-5', 'src/main.tsx', {
      milestoneId: 'm-7',
      missingPaths: ['tailwind.config.js', 'postcss.config.js'],
    })

    // One concrete action, which is the property every directive obeyed quickly has had.
    expect(directive).toContain('"tailwind.config.js", "postcss.config.js"')
    expect(directive).toContain('m-7 is the active milestone')
    expect(directive).toContain('Stop editing "src/main.tsx"')
  })

  it('falls back to the checklist when the active milestone owes no file', () => {
    const directive = redeliveredMilestoneDirective('m-5', 'src/main.tsx', null)

    expect(directive).toContain('Move to the next milestone in the checklist')
    expect(directive).not.toContain('is the active milestone')
  })

  it('does not accuse the model of an error, since the write did succeed', () => {
    const directive = redeliveredMilestoneDirective('m-5', 'src/main.tsx', null)

    expect(directive.toLowerCase()).not.toContain('rejected')
    expect(directive.toLowerCase()).not.toContain('blocked')
  })

  it('leaves room for a rewrite the model can actually justify', () => {
    const directive = redeliveredMilestoneDirective('m-5', 'src/main.tsx', {
      milestoneId: 'm-7',
      missingPaths: ['tailwind.config.js'],
    })

    // A flat prohibition with no exit is the shape this project has had to undo repeatedly.
    expect(directive).toContain('say what is wrong with it in your explanation')
  })
})
