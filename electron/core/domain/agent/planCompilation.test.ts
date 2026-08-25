import { describe, it, expect } from 'vitest'
import { ensureRunnableMilestone, ensureEntrypointMilestones } from './planCompilation'

describe('ensureEntrypointMilestones', () => {
  const greenfield = { hasManifest: false, hasHtmlEntrypoint: false }
  const pagePlan = [
    { id: 'm-1', title: 'The Dashboard page shows the totals — `src/pages/DashboardPage.tsx`', status: 'pending' as const },
    { id: 'm-2', title: 'Navigation between the pages works — `src/App.tsx`', status: 'pending' as const },
  ]

  it('prepends the entry files a greenfield web plan never asks for', () => {
    // Measured twice on 2026-08-25, before and after strengthening the planner prompt: the plan
    // went straight to pages, no index.html was ever written, and fifty steps produced zero
    // builds because nothing could compile.
    const plan = ensureEntrypointMilestones(pagePlan, greenfield)

    expect(plan).toHaveLength(6)
    expect(plan.slice(0, 4).map((m) => m.title)).toEqual([
      expect.stringContaining('`package.json`'),
      expect.stringContaining('`tsconfig.json`'),
      expect.stringContaining('`index.html`'),
      expect.stringContaining('`src/main.tsx`'),
    ])
    expect(plan.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6'])
    // The work the model planned is still there, in order, after the entry files.
    expect(plan[4].title).toContain('DashboardPage.tsx')
  })

  it('carries exactly the files the project\'s own declared check needs to pass', () => {
    // Both entries here were left out of a first version and put back by a measured run.
    // package.json: run three emitted zero commands in fifty steps, because a manifest-less
    // workspace gives dependencies_missing nothing to compare and verification_due no declared
    // command to name. tsconfig.json: run four wrote "build": "tsc && vite build" into its own
    // manifest, and tsc with no config exits by printing its usage.
    const plan = ensureEntrypointMilestones(pagePlan, greenfield)

    expect(plan[0].title).toContain('build script')
    expect(plan[1].title).toContain('`tsconfig.json`')
    // vite.config.ts stays out: nothing measured has needed it.
    expect(plan.some((m) => m.title.includes('vite.config'))).toBe(false)
  })

  it('requires the generated tsconfig to typecheck without emitting JavaScript into src', () => {
    const tsconfig = ensureEntrypointMilestones(pagePlan, greenfield).find((m) => m.title.includes('`tsconfig.json`'))

    expect(tsconfig?.title).toContain('`noEmit: true`')
    expect(tsconfig?.falsifiableHypothesis).toContain('noEmit')
  })

  it('adds only what the plan is missing', () => {
    const withEntry = [
      { id: 'm-1', title: 'The entry script mounts the app — `src/main.tsx`', status: 'pending' as const },
      ...pagePlan,
    ]

    const plan = ensureEntrypointMilestones(withEntry, greenfield)

    expect(plan).toHaveLength(6)
    expect(plan.filter((m) => m.title.includes('`src/main.tsx`'))).toHaveLength(1)
    expect(plan[0].title).toContain('`package.json`')
    expect(plan[2].title).toContain('`index.html`')
  })

  it('stays out when the workspace already has an entry page or a manifest', () => {
    expect(ensureEntrypointMilestones(pagePlan, { hasManifest: false, hasHtmlEntrypoint: true })).toEqual(pagePlan)
    expect(ensureEntrypointMilestones(pagePlan, { hasManifest: true, hasHtmlEntrypoint: false })).toEqual(pagePlan)
    expect(ensureEntrypointMilestones(pagePlan, null)).toEqual(pagePlan)
  })

  it('treats only a root index.html as the entry page the plan already covers', () => {
    // Run five of 2026-08-25 planned `public/index.html`, which a default Vite build never uses
    // as the entry. A blanket "the plan mentions some HTML" check switched the whole pass off,
    // so that run also lost tsconfig.json and src/main.tsx to one misplaced file.
    const withPublicHtml = [{ id: 'm-1', title: 'The page loads the app — `public/index.html`', status: 'pending' as const }, ...pagePlan]

    const plan = ensureEntrypointMilestones(withPublicHtml, greenfield)

    expect(plan.some((m) => m.title.includes('`index.html`'))).toBe(true)
    expect(plan.some((m) => m.title.includes('`tsconfig.json`'))).toBe(true)
    expect(plan.some((m) => m.title.includes('`src/main.tsx`'))).toBe(true)
    // The model's own entry is left alone rather than rewritten.
    expect(plan.some((m) => m.title.includes('`public/index.html`'))).toBe(true)
  })

  it('adds no entry page when the plan already names a root index.html', () => {
    const withRootHtml = [{ id: 'm-1', title: 'The page loads the app — `index.html`', status: 'pending' as const }, ...pagePlan]

    const plan = ensureEntrypointMilestones(withRootHtml, greenfield)

    expect(plan.filter((m) => m.title.includes('`index.html`'))).toHaveLength(1)
  })

  it('never hands a vite skeleton to a plan that is not a web app', () => {
    // A Python or Rust plan names no web source file: inventing an entry page for it would be
    // work the user never asked for, in a stack this module knows nothing about.
    const pythonPlan = [
      { id: 'm-1', title: 'The CLI parses its arguments — `src/cli.py`', status: 'pending' as const },
      { id: 'm-2', title: 'The parser handles the config — `src/config.py`', status: 'pending' as const },
    ]

    expect(ensureEntrypointMilestones(pythonPlan, greenfield)).toEqual(pythonPlan)
  })
})
describe('ensureRunnableMilestone', () => {
  const files = [
    { id: 'm-1', title: 'Create `package.json`', status: 'pending' as const },
    { id: 'm-2', title: 'Create `src/App.tsx`', status: 'pending' as const },
  ]

  it('appends the milestone a file-shaped plan can never contain', () => {
    // Measured 2026-08-25: 14/15 verified, every deliverable present, and `vite build` emitting
    // no JavaScript. Nothing in the plan was about the application working.
    const plan = ensureRunnableMilestone(files, 'npm run build')

    expect(plan).toHaveLength(3)
    expect(plan[2].verificationCommand).toBe('npm run build')
    expect(plan[2].title).toContain('builds and runs')
  })

  it('names no file, so no write can close it', () => {
    const appended = ensureRunnableMilestone(files, 'npm run build')[2]

    expect(appended.title).not.toMatch(/\.[a-z]{2,4}\b/)
  })

  it('invents nothing when the project declares no check', () => {
    expect(ensureRunnableMilestone(files, null)).toEqual(files)
    expect(ensureRunnableMilestone(files, undefined)).toEqual(files)
  })

  it('does not duplicate a check the plan already declares', () => {
    const withCheck = [...files, { id: 'm-3', title: 'Build it', status: 'pending' as const, verificationCommand: 'npm run build' }]

    expect(ensureRunnableMilestone(withCheck, 'npm run build')).toHaveLength(3)
  })

  it('stays before the closing report milestone, which the finish tool owns', () => {
    const withClosing = [...files, { id: 'm-3', title: 'Write the final report and finish', status: 'pending' as const }]
    const plan = ensureRunnableMilestone(withClosing, 'npm run build')

    expect(plan[2].verificationCommand).toBe('npm run build')
    expect(plan[3].title).toContain('final report')
    expect(plan.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-4'])
  })
})
