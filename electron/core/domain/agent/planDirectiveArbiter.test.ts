import { describe, it, expect } from 'vitest'
import { resolvePlanDirective, type PlanDirectiveInput } from './planDirectiveArbiter'
import type { PlanMilestone } from './planAndSolveGraph'
import type { MilestoneDeliverableStatus } from './milestoneDeliverableResolver'

/**
 * The arbiter exists because fifteen guards wrote into one prompt and none of them decided
 * what the model should read now. What these tests pin is therefore not "does each directive
 * render" — each builder has its own tests — but that exactly ONE is chosen, and which.
 *
 * The `verification_due` branch is the one that was missing entirely. `hasVerifiedBuild` is
 * raised only by a command the model runs or by the finish gate, and the focus block forbids
 * `finish` until the milestones are verified, which only a passing verification achieves. In
 * three live runs of fifty steps the model never issued a single command: with no directive
 * ever naming one, `write_file` was the only move it was pointed at.
 */

const VERIFICATION = { command: 'npm run build', source: 'package.json script "build"' }

function milestone(id: string, title: string, status: PlanMilestone['status'] = 'in_progress'): PlanMilestone {
  return { id, title, status }
}

function input(overrides: Partial<PlanDirectiveInput> = {}): PlanDirectiveInput {
  const milestones = overrides.milestones ?? [milestone('m-1', 'Create `src/App.tsx`')]
  return {
    hasVerifiedBuild: false,
    milestones,
    activeMilestone: milestones.find((m) => m.status !== 'verified' && m.status !== 'failed'),
    deliverableStatusOf: () => 'satisfied',
    missingDependencies: [],
    undeclaredDependencies: [],
    packagesWithFailedInstall: [],
    verificationCommand: VERIFICATION,
    verificationFailing: false,
    disconnectedEntrypoint: null,
    ...overrides,
  }
}

/** Status per milestone id, defaulting to `satisfied` for anything unlisted. */
function statusMap(map: Record<string, MilestoneDeliverableStatus>) {
  return (m: PlanMilestone): MilestoneDeliverableStatus => map[m.id] ?? 'satisfied'
}

describe('verification_due — the directive whose absence stalled every run', () => {
  it('orders the project’s own command once every open deliverable is on disk', () => {
    const decision = resolvePlanDirective(input())

    expect(decision.kind).toBe('verification_due')
    expect(decision.blockDirective).toContain('npm run build')
    expect(decision.blockDirective).toContain('run_command')
    expect(decision.closureStepDirective).toBeNull()
  })

  it('names the command exactly once, as an order rather than a suggestion', () => {
    const directive = resolvePlanDirective(input()).blockDirective!

    expect(directive).toContain('Your next tool call MUST be "run_command" with the command: npm run build')
    // A directive that offers a choice invites the model to delegate it — the ERESOLVE lesson.
    expect(directive).not.toMatch(/\beither\b|\bor you can\b|choose/i)
  })

  it('stays silent while any open milestone is still owed a file', () => {
    const milestones = [milestone('m-1', 'Create `src/App.tsx`'), milestone('m-2', 'Create `src/main.tsx`')]
    const decision = resolvePlanDirective(
      input({ milestones, deliverableStatusOf: statusMap({ 'm-2': 'unsatisfied' }) })
    )

    expect(decision.kind).toBe('focus')
    expect(decision.blockDirective).toBeNull()
  })

  it('does not count a milestone that names no artefact as work still to write', () => {
    const milestones = [milestone('m-1', 'Ensure every button has a 44x44 touch target')]
    const decision = resolvePlanDirective(
      input({ milestones, deliverableStatusOf: statusMap({ 'm-1': 'not_applicable' }) })
    )

    // Nothing can be written for it, so it never means "keep writing". It still blocks session
    // closure — that judgement belongs to assessPostVerificationClosure, not here.
    expect(decision.kind).toBe('verification_due')
  })

  it('stays silent for a project that declares no command of its own', () => {
    expect(resolvePlanDirective(input({ verificationCommand: null })).kind).toBe('focus')
  })

  it('stays silent once a verification has already passed', () => {
    const milestones = [milestone('m-1', 'Create `src/App.tsx`')]
    const decision = resolvePlanDirective(input({ milestones, hasVerifiedBuild: true }))

    expect(decision.kind).not.toBe('verification_due')
  })

  it('stays silent on an empty plan: there is nothing a check could attest', () => {
    expect(resolvePlanDirective(input({ milestones: [], activeMilestone: undefined })).kind).toBe('focus')
  })

  it('ignores milestones already verified or abandoned when deciding the plan is delivered', () => {
    const milestones = [
      milestone('m-1', 'Create `src/App.tsx`', 'verified'),
      milestone('m-2', 'Create `src/gone.tsx`', 'failed'),
      milestone('m-3', 'Create `src/main.tsx`'),
    ]
    const decision = resolvePlanDirective(
      input({ milestones, deliverableStatusOf: statusMap({ 'm-2': 'unsatisfied' }) })
    )

    // m-2 was abandoned on purpose; letting its missing file hold the plan open forever is
    // exactly what every other consumer of the milestone list refuses to do.
    expect(decision.kind).toBe('verification_due')
  })
})

describe('dependencies_missing — ordered ahead of the check it is a precondition of', () => {
  it('orders the install instead of a build that cannot pass', () => {
    const decision = resolvePlanDirective(input({ missingDependencies: ['react', 'vite'] }))

    expect(decision.kind).toBe('dependencies_missing')
    expect(decision.blockDirective).toContain('npm install')
    expect(decision.blockDirective).toContain('"react"')
    expect(decision.blockDirective).toContain('"vite"')
    expect(decision.blockDirective).not.toContain('npm run build')
  })

  it('forbids the workaround the model actually reaches for', () => {
    const directive = resolvePlanDirective(input({ missingDependencies: ['react'] })).blockDirective!

    // Faced with "vite: not found" a small model rewrites the manifest. Naming that here costs
    // one line and is the failure this directive exists to pre-empt.
    expect(directive).toContain('do NOT edit package.json')
  })

  it('does not enumerate an unbounded list', () => {
    const many = Array.from({ length: 30 }, (_, i) => `pkg-${i}`)
    const directive = resolvePlanDirective(input({ missingDependencies: many })).blockDirective!

    expect(directive).toContain('+18 more')
    expect(directive).not.toContain('"pkg-29"')
  })

  it('stays silent once a verification has passed, so a green build is never reopened', () => {
    const decision = resolvePlanDirective(
      input({ missingDependencies: ['react'], hasVerifiedBuild: true, milestones: [milestone('m-1', 'Run the app')] })
    )

    expect(decision.kind).not.toBe('dependencies_missing')
  })
})

describe('priority — exactly one directive, and the declared one', () => {
  it('closure outranks the install and the check', () => {
    const milestones = [milestone('m-1', 'Ensure every button has a 44x44 touch target')]
    const decision = resolvePlanDirective(
      input({
        hasVerifiedBuild: true,
        milestones,
        deliverableStatusOf: statusMap({ 'm-1': 'not_applicable' }),
        missingDependencies: ['react'],
      })
    )

    expect(decision.kind).toBe('session_closure')
    expect(decision.blockDirective).toContain('CLOSE THE SESSION')
  })

  it('the install outranks the check', () => {
    const decision = resolvePlanDirective(input({ missingDependencies: ['react'] }))

    expect(decision.kind).toBe('dependencies_missing')
  })

  it('the check outranks the unprovable-milestone swap', () => {
    const milestones = [milestone('m-1', 'Create the `src/services` folder')]
    const decision = resolvePlanDirective(
      input({ milestones, deliverableStatusOf: statusMap({ 'm-1': 'not_applicable' }) })
    )

    // Both apply: the active milestone names no artefact AND nothing is owed a file. Running
    // the check is the action that moves the plan; closing a milestone on judgement is not.
    expect(decision.kind).toBe('verification_due')
  })

  it('falls back to the unprovable swap when no command can be run', () => {
    const milestones = [milestone('m-1', 'Create the `src/services` folder')]
    const decision = resolvePlanDirective(
      input({
        milestones,
        verificationCommand: null,
        deliverableStatusOf: statusMap({ 'm-1': 'not_applicable' }),
      })
    )

    expect(decision.kind).toBe('unprovable_milestone')
    expect(decision.blockDirective).toBeNull()
    expect(decision.closureStepDirective).toContain('update_plan')
  })

  it('never returns both a block directive and a closure step', () => {
    const cases: PlanDirectiveInput[] = [
      input(),
      input({ missingDependencies: ['react'] }),
      input({ verificationCommand: null, deliverableStatusOf: () => 'not_applicable' }),
      input({ hasVerifiedBuild: true, deliverableStatusOf: () => 'not_applicable' }),
      input({ deliverableStatusOf: () => 'unsatisfied' }),
    ]

    for (const c of cases) {
      const decision = resolvePlanDirective(c)
      expect(Boolean(decision.blockDirective) && Boolean(decision.closureStepDirective)).toBe(false)
    }
  })

  it('leaves the ordinary case untouched: real work remains and a file action delivers it', () => {
    const decision = resolvePlanDirective(input({ deliverableStatusOf: () => 'unsatisfied' }))

    expect(decision).toEqual({ kind: 'focus', blockDirective: null, closureStepDirective: null })
  })
})

/**
 * The blocker the arbiter's own live run exposed: `npm run build` finally ran, and died on
 * `Cannot find module '@vitejs/plugin-react'` — imported by `vite.config.ts`, declared nowhere.
 * The per-write gate reported it 44 times in that session and the model never acted, because
 * it was always a note attached to something else rather than the next action.
 */
describe('dependencies_undeclared — the blocker the first live run exposed', () => {
  const plugin = { packageName: '@vitejs/plugin-react', importedBy: ['vite.config.ts'] }

  it('orders the install and names the file that imports the package', () => {
    const decision = resolvePlanDirective(input({ undeclaredDependencies: [plugin] }))

    expect(decision.kind).toBe('dependencies_undeclared')
    expect(decision.blockDirective).toContain('npm install @vitejs/plugin-react')
    expect(decision.blockDirective).toContain('vite.config.ts')
  })

  it('outranks both the install of declared packages and the check', () => {
    const decision = resolvePlanDirective(
      input({ undeclaredDependencies: [plugin], missingDependencies: ['react'] })
    )

    // `npm install <pkg>` declares AND installs, so settling the undeclared ones first cannot
    // waste a step: the missing-package state is re-evaluated on the following turn.
    expect(decision.kind).toBe('dependencies_undeclared')
    expect(decision.blockDirective).not.toContain('npm run build')
  })

  it('yields to session closure, so a verified project is never reopened', () => {
    const milestones = [milestone('m-1', 'Ensure every button has a 44x44 touch target')]
    const decision = resolvePlanDirective(
      input({
        milestones,
        hasVerifiedBuild: true,
        deliverableStatusOf: () => 'not_applicable',
        undeclaredDependencies: [plugin],
      })
    )

    expect(decision.kind).toBe('session_closure')
  })

  it('names the escape for a package the model invented rather than only ordering an install', () => {
    const directive = resolvePlanDirective(
      input({ undeclaredDependencies: [{ packageName: '@tailwindcss/react', importedBy: ['src/components/Sidebar.tsx'] }] })
    ).blockDirective!

    // `@tailwindcss/react` does not exist on npm — it is the invented package the audit found
    // on disk. An install order with no second branch would loop on a failing command.
    expect(directive).toContain('does not exist on npm')
    expect(directive).toContain('rewrite the file that imports it')
  })

  it('does not enumerate an unbounded list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ packageName: `pkg-${i}`, importedBy: [`src/f${i}.ts`] }))
    const directive = resolvePlanDirective(input({ undeclaredDependencies: many })).blockDirective!

    expect(directive).toContain('12 more not listed')
    expect(directive).not.toContain('pkg-19')
  })
})

/**
 * The regression the `dependencies_undeclared` wave produced, measured on the live run of
 * 2026-08-24: the model imported `@tailwindcss/react`, which does not exist on npm; the
 * directive correctly ordered the install; the install failed; and because the directive is
 * recomputed from disk every turn it ordered the identical command again — thirteen steps.
 */
describe('dependencies_uninstallable — a failed install is not re-ordered', () => {
  const invented = { packageName: '@tailwindcss/react', importedBy: ['src/components/Sidebar.tsx'] }
  const real = { packageName: '@vitejs/plugin-react', importedBy: ['vite.config.ts'] }

  it('stops ordering the install once this session has already failed it', () => {
    const decision = resolvePlanDirective(
      input({ undeclaredDependencies: [invented], packagesWithFailedInstall: ['@tailwindcss/react'] })
    )

    expect(decision.kind).toBe('dependencies_uninstallable')
    expect(decision.blockDirective).not.toContain('npm install @tailwindcss/react')
  })

  it('names the file to change instead, which is the thing that can actually change', () => {
    const directive = resolvePlanDirective(
      input({ undeclaredDependencies: [invented], packagesWithFailedInstall: ['@tailwindcss/react'] })
    ).blockDirective!

    expect(directive).toContain('src/components/Sidebar.tsx')
    expect(directive).toContain('Do NOT run any install command')
  })

  it('still orders the install for a package this session has not tried', () => {
    const decision = resolvePlanDirective(
      input({ undeclaredDependencies: [invented, real], packagesWithFailedInstall: ['@tailwindcss/react'] })
    )

    // One message, one instruction: the installable one is a single command away, so it goes
    // first and the file rewrite waits its turn.
    expect(decision.kind).toBe('dependencies_undeclared')
    expect(decision.blockDirective).toContain('npm install @vitejs/plugin-react')
    expect(decision.blockDirective).not.toContain('@tailwindcss/react')
  })

  it('orders the ordinary install when nothing has failed yet', () => {
    expect(resolvePlanDirective(input({ undeclaredDependencies: [real] })).kind).toBe('dependencies_undeclared')
  })
})

/**
 * The contradiction the arbiter itself was producing, measured on 2026-08-24 steps 26-34: the
 * plan block ordered the build while the tool result from that same build ordered a file fix
 * and forbade re-running. `hasVerifiedBuild` is false both before the first run and after a
 * failure, and the right next action is opposite in the two.
 */
describe('verification_failing — the check already ran and failed', () => {
  it('stops ordering the check once it has failed with nothing written since', () => {
    const decision = resolvePlanDirective(input({ verificationFailing: true }))

    expect(decision.kind).toBe('verification_failing')
    expect(decision.blockDirective).toContain('DO NOT RUN IT AGAIN YET')
  })

  it('defers to the diagnostic instead of prescribing a second, competing action', () => {
    const directive = resolvePlanDirective(input({ verificationFailing: true })).blockDirective!

    expect(directive).not.toContain('MUST be "write_file"')
    expect(directive).not.toContain('MUST be "run_command"')
    expect(directive).toContain('It is the only instruction that applies right now')
  })

  it('goes back to ordering the check once a file has changed', () => {
    expect(resolvePlanDirective(input({ verificationFailing: false })).kind).toBe('verification_due')
  })

  it('still yields to session closure and to a missing install', () => {
    const closed = resolvePlanDirective(
      input({ verificationFailing: true, hasVerifiedBuild: true, deliverableStatusOf: () => 'not_applicable' })
    )
    const installing = resolvePlanDirective(input({ verificationFailing: true, missingDependencies: ['react'] }))

    expect(closed.kind).toBe('session_closure')
    expect(installing.kind).toBe('dependencies_missing')
  })
})

describe('entrypoint_disconnected — a green check on a page that loads nothing', () => {
  const disconnected = { htmlPath: 'index.html', expectedEntry: 'src/main.tsx' }

  it('orders the page fix before ordering the check', () => {
    const decision = resolvePlanDirective(input({ disconnectedEntrypoint: disconnected }))

    expect(decision.kind).toBe('entrypoint_disconnected')
    expect(decision.blockDirective).toContain('index.html')
  })

  it('still yields to a missing install, which blocks everything', () => {
    const decision = resolvePlanDirective(
      input({ disconnectedEntrypoint: disconnected, missingDependencies: ['react'] })
    )

    expect(decision.kind).toBe('dependencies_missing')
  })

  it('goes back to the check once the page is wired', () => {
    expect(resolvePlanDirective(input({ disconnectedEntrypoint: null })).kind).toBe('verification_due')
  })
})
