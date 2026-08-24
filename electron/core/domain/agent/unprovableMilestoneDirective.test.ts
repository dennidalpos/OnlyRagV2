import { describe, it, expect } from 'vitest'
import { buildUnprovableMilestoneDirective, shouldDirectUnprovableClosure } from './unprovableMilestoneDirective'

/**
 * live-full-task, 2026-08-24: milestone m-10 was "Create `src/services` folder" — a directory,
 * so `extractDeliverablePaths` finds nothing and the milestone resolves `not_applicable`. Focus
 * directive 2 told the model that writing the milestone's files would close it, so it wrote
 * `src/services/index.tsx` three times with three different placeholder bodies before the
 * thrashing guard blocked it and the loop guard abandoned the milestone.
 */
describe('shouldDirectUnprovableClosure', () => {
  const milestone = { id: 'm-10', title: 'Create `src/services` folder' }

  it('fires for a milestone that names no artefact', () => {
    expect(shouldDirectUnprovableClosure(milestone, 'not_applicable')).toBe(true)
  })

  // A milestone whose files are genuinely missing must keep asking for them: telling the model
  // to close it on its own judgement is exactly the fabricated verification the promotion
  // rules exist to prevent.
  it('stays silent for a milestone whose files are missing', () => {
    expect(shouldDirectUnprovableClosure(milestone, 'unsatisfied')).toBe(false)
  })

  it('stays silent for a milestone whose files are all on disk', () => {
    expect(shouldDirectUnprovableClosure(milestone, 'satisfied')).toBe(false)
  })

  it('stays silent when there is no active milestone', () => {
    expect(shouldDirectUnprovableClosure(null, 'not_applicable')).toBe(false)
  })

  /**
   * `update_plan` RUNS a declared verificationCommand and promotes on its exit code, so a
   * command demonstrably CAN prove such a milestone. The live run of 2026-08-24 put the
   * directive on m-5 "Install Tailwind CSS", whose declared proof was `npm install tailwindcss
   * postcss autoprefixer`, under the words "no command can prove it".
   */
  it('stays silent when the milestone declares a verification command, however unprovable its title', () => {
    expect(
      shouldDirectUnprovableClosure(
        { id: 'm-5', title: 'Install Tailwind CSS', verificationCommand: 'npm install tailwindcss postcss autoprefixer' },
        'not_applicable'
      )
    ).toBe(false)
  })

  it('fires when the declared verification command is blank rather than absent', () => {
    expect(shouldDirectUnprovableClosure({ ...milestone, verificationCommand: '   ' }, 'not_applicable')).toBe(true)
  })
})

describe('buildUnprovableMilestoneDirective', () => {
  const milestone = { id: 'm-10', title: 'Create `src/services` folder' }

  it('renders as directive 2, so it can replace the one it contradicts', () => {
    expect(buildUnprovableMilestoneDirective(milestone).startsWith('2.')).toBe(true)
  })

  it('names the milestone id and title update_plan needs', () => {
    const directive = buildUnprovableMilestoneDirective(milestone)
    expect(directive).toContain('"m-10"')
    expect(directive).toContain('Create `src/services` folder')
    expect(directive).toContain('update_plan')
  })

  // The observed failure was the model writing a NEW file to earn the closure. Saying only
  // "call update_plan" leaves that attempt open; saying it will be blocked as a loop closes it.
  it('states that writing a new file cannot satisfy it', () => {
    const directive = buildUnprovableMilestoneDirective(milestone)
    expect(directive).toContain('NAMES NO FILE')
    expect(directive).toContain('creating a new file will NOT satisfy it')
  })

  // "Ensure buttons have a 44x44 touch target" is real work in files that already exist; only
  // its proof is missing. A directive that said "just close it" would rubber-stamp every one.
  it('asks for the work to be done before the milestone is closed', () => {
    const directive = buildUnprovableMilestoneDirective(milestone)
    expect(directive).toContain('Do the work it describes')
  })
})
