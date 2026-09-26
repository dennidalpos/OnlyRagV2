import { describe, it, expect } from 'vitest'
import { partialDeliveryDirective, promotionNote, redeliveredMilestoneDirective, selectMilestonesProvenByVerification } from './milestoneVerificationPromotion'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { MilestoneDeliverableStatus } from '../../../../shared/domain/agent/milestoneDeliverableResolver'

function milestone(id: string, title: string, status: PlanMilestone['status'] = 'pending', verificationCommand = 'npm run build'): PlanMilestone {
  return { id, title, status, verificationCommand }
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
    expect(selectMilestonesProvenByVerification(plan, 'npm run build', statusMap()).map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3'])
  })

  it('does not let a build prove a milestone that promises behavior', () => {
    // Live full task run 2026-09-24: the smoke-test milestone (npm test) was marked verified by a
    // green `npm run build` although package.json had no test script and the test never ran.
    const smoke = {
      ...milestone('m-2', 'A smoke test renders the App — `src/App.test.jsx`'),
      verificationCommand: undefined,
      proposedVerificationCommand: 'npm test',
    }
    const plan = [{ ...milestone('m-1', 'Create `a.ts`'), verificationCommand: undefined }, smoke]

    expect(selectMilestonesProvenByVerification(plan, 'npm run build', statusMap()).map((m) => m.id)).toEqual(['m-1'])
    expect(selectMilestonesProvenByVerification(plan, 'npm test', statusMap()).map((m) => m.id)).toEqual(['m-1', 'm-2'])
  })

  it('leaves alone a milestone that is already verified', () => {
    const plan = [milestone('m-1', 'Create `a.ts`', 'verified'), milestone('m-2', 'Create `b.ts`')]
    expect(selectMilestonesProvenByVerification(plan, 'npm run build', statusMap()).map((m) => m.id)).toEqual(['m-2'])
  })

  it('does not resurrect a milestone the loop guard abandoned', () => {
    // `failed` means the work genuinely did not happen; a later green build does not undo that.
    const plan = [milestone('m-1', 'Create `a.ts`', 'failed'), milestone('m-2', 'Create `b.ts`')]
    expect(selectMilestonesProvenByVerification(plan, 'npm run build', statusMap()).map((m) => m.id)).toEqual(['m-2'])
  })

  it('never promotes the completion milestone, which the finish tool owns', () => {
    const plan = [
      milestone('m-1', 'Create `a.ts`'),
      milestone('m-2', '🛑 Completamento dell ultimo task, riepilogo finale e arresto dell agente (invoke "finish")'),
    ]
    expect(selectMilestonesProvenByVerification(plan, 'npm run build', statusMap()).map((m) => m.id)).toEqual(['m-1'])
  })

  it('never promotes a milestone that names no artefact', () => {
    // The nkn0 lesson: nothing the build compiled can speak for "ensure buttons are 44x44 px",
    // so closing it on a passing build would fabricate verification all over again.
    const plan = [milestone('m-1', 'Ensure buttons have a minimum touch target of 44x44 px'), milestone('m-2', 'Create `a.ts`')]
    const proven = selectMilestonesProvenByVerification(plan, 'npm run build', statusMap({ 'm-1': 'not_applicable' }))
    expect(proven.map((m) => m.id)).toEqual(['m-2'])
  })

  it('never promotes a milestone whose files are missing or are placeholders', () => {
    const plan = [milestone('m-1', 'Create `a.ts`'), milestone('m-2', 'Create `b.ts`')]
    const proven = selectMilestonesProvenByVerification(plan, 'npm run build', statusMap({ 'm-1': 'unsatisfied' }))
    expect(proven.map((m) => m.id)).toEqual(['m-2'])
  })

  it('promotes nothing when the plan is empty', () => {
    expect(selectMilestonesProvenByVerification([], 'npm run build', statusMap())).toEqual([])
  })

  it('promotes only milestones associated with the command that passed', () => {
    const plan = [
      milestone('m-1', 'Create `a.ts`', 'pending', 'npm run build'),
      milestone('m-2', 'Behavior works — `a.test.ts`', 'pending', 'npm test'),
      milestone('m-3', 'Create `b.ts`', 'pending', 'npm run lint'),
    ]

    expect(selectMilestonesProvenByVerification(plan, 'npm run build', statusMap()).map((m) => m.id)).toEqual(['m-1'])
  })
})

describe('promotionNote', () => {
  it('distinguishes compilation from behavior evidence', () => {
    expect(promotionNote('npm run build')).toContain('Compilation evidence')
    expect(promotionNote('npm test')).toContain('Behavior evidence')
  })
})

/** live-full-task, 2026-08-24: milestone m-6 was "Configure Tailwind CSS in `postcss.config.js` and `tailwind.config.js`". */
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

  /** This text is a tool result, so it is replayed in the history block for as long as it survives trimming, while the plan block is rebuilt from live state every turn. */
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

/** The half of the churn the no-op detector and the partial-delivery directive both miss: a REAL rewrite of a milestone that was already complete. */
describe('redeliveredMilestoneDirective', () => {
  it('states that the write was applied to a file of an already complete milestone', () => {
    const note = redeliveredMilestoneDirective('m-5', 'src/main.tsx', null)

    expect(note).toContain('[PLAN NOTE]')
    expect(note).toContain('src/main.tsx')
    expect(note).toContain('milestone m-5')
    expect(note).toContain('the write was applied')
  })

  it('names the file the active milestone is still waiting for', () => {
    const note = redeliveredMilestoneDirective('m-5', 'src/main.tsx', {
      milestoneId: 'm-7',
      missingPaths: ['tailwind.config.js', 'postcss.config.js'],
    })

    expect(note).toContain('"tailwind.config.js", "postcss.config.js"')
    expect(note).toContain('active milestone m-7')
  })

  it('never orders the model to stop editing: fixing a delivered file is ordinary work', () => {
    const note = redeliveredMilestoneDirective('m-5', 'src/main.tsx', { milestoneId: 'm-7', missingPaths: ['a.ts'] })

    expect(note).not.toMatch(/MUST|Stop editing|Do not/i)
    expect(note.toLowerCase()).not.toContain('rejected')
    expect(note.toLowerCase()).not.toContain('blocked')
  })
})
