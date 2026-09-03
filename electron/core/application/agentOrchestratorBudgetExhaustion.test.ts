import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  promoteMilestonesProvenBy,
  selectMilestonesAwaitingVerification,
} from './agentOrchestratorCircuitBreakerAndVerification'
import type { PlanMilestone } from '../../../shared/domain/agent/planAndSolveGraph'
import type { ToolResultProcessingContext } from './agentOrchestratorToolResultTypes'

/**
 * Reproduction of live-full-task, 2026-08-25T12:11 — the run behind the tracker entry
 * "nessuna milestone promossa a verified nonostante 16 file su disco".
 *
 * The titles and the file list below are transcribed from that session's own state file
 * (`<workspace>/.onlyrag/sessions/.agent_state_live-full-task.json`) and from its episode log.
 * The run ended 50/50 steps with all fourteen milestones `in_progress`, each holding
 * "Awaiting a passing verification command", and the audit log records for the whole session:
 * zero `-> VERIFIED` transitions, zero promotion lines, and zero `update_plan` refusals for
 * missing deliverables — the model asked for `verified` not once, so milestoneUpdateAuthority
 * refused nothing. All twelve of its `run_command` calls were `npm install`, and `finish` was
 * never invoked.
 *
 * These tests pin the two halves of that diagnosis, which point in opposite directions and are
 * easy to confuse: the promotion DECISION was correct on this exact input all along, and the
 * promotion was never TRIGGERED because no exit path ran a check.
 */

const LIVE_MILESTONE_TITLES: readonly [string, string][] = [
  ['m-1', 'The project declares its dependencies and its build script — `package.json`'],
  ['m-2', 'The TypeScript compiler knows which files to check — `tsconfig.json`'],
  [
    'm-3',
    'The app has its Tailwind base styles — `src/styles/globals.css`; The project has a clean architecture — `src/services/`',
  ],
  ['m-4', 'The entrypoint loads the application — `index.html`'],
  ['m-5', 'The root component mounts the application — `src/main.tsx`'],
  ['m-6', 'The Dashboard page is created — `src/pages/DashboardPage.tsx`'],
  ['m-7', 'The Tasks page lists the tasks and marks one complete — `src/pages/TasksPage.tsx`'],
  ['m-8', 'Basic task cards are implemented on the Tasks page — `src/components/TaskCard.tsx`'],
  ['m-9', 'Navigation between Dashboard and Tasks pages is functional — `src/App.tsx`'],
  ['m-10', 'Left sidebar navigation is implemented for desktop — `src/components/Sidebar.tsx`'],
  ['m-11', 'Hamburger menu with slide-out drawer is implemented for mobile — `src/components/HamburgerMenu.tsx`'],
  ['m-12', 'Buttons have a minimum touch target of 44x44 px — `src/components/Button.tsx`'],
  ['m-13', 'Responsive layout using Tailwind CSS utilities — `src/styles/globals.css`'],
  [
    'm-14',
    'Mobile-first approach from the very beginning — `src/components/TaskCard.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/TasksPage.tsx`; Application is fully runnable, usable, and responsive',
  ],
]

/** Every file the run wrote, in the order its episode log records them. */
const LIVE_WRITTEN_FILES = [
  'package.json',
  'tsconfig.json',
  'src/styles/globals.css',
  'src/index.html',
  'src/main.tsx',
  'src/pages/DashboardPage.tsx',
  'src/components/TaskCard.tsx',
  'src/pages/TasksPage.tsx',
  'src/components/Button.tsx',
  'src/components/HamburgerMenu.tsx',
  'src/App.tsx',
  'src/components/Sidebar.tsx',
]

let tempDir: string

/** Real content, so nothing here is filtered out as a placeholder by isPlaceholderContent. */
function writeLiveWorkspace(files: readonly string[]) {
  for (const relative of files) {
    const full = path.join(tempDir, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, `export const value = ${JSON.stringify(relative)}\nexport default value\n`)
  }
}

function livePlan(): PlanMilestone[] {
  return LIVE_MILESTONE_TITLES.map(([id, title]) => ({ id, title, status: 'in_progress' }) as PlanMilestone)
}

/** The narrow slice of the orchestrator context both functions under test read. */
function makeDeps(plan: PlanMilestone[], logs: string[] = []) {
  return {
    workspacePath: tempDir,
    goalPlanner: {
      getMilestones: () => plan,
      updateMilestone: (id: string, status: PlanMilestone['status'], notes?: string) => {
        const target = plan.find((m) => m.id === id)
        if (!target) return false
        target.status = status
        target.notes = notes
        return true
      },
      getProgressSummary: () => ({
        completed: plan.filter((m) => m.status === 'verified').length,
        total: plan.length,
        percentage: 0,
      }),
    },
    emitLog: (_level: string, message: string) => logs.push(message),
  } as unknown as Pick<ToolResultProcessingContext, 'workspacePath' | 'goalPlanner' | 'emitLog'>
}

describe('milestone promotion on the live-full-task workspace', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-budget-exhaustion-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('finds all fourteen milestones promotable on the files that run actually produced', () => {
    // The heart of the diagnosis. Every title resolves against the real workspace, including
    // m-4's bare `index.html` (written to `src/index.html`, matched by the probe's basename
    // fallback) and m-3's `src/services/`, which names no file and is therefore no obstacle.
    // Nothing in the promotion decision was blocking; it was simply never asked.
    writeLiveWorkspace(LIVE_WRITTEN_FILES)
    const plan = livePlan()

    expect(selectMilestonesAwaitingVerification(makeDeps(plan)).map((m) => m.id)).toEqual(
      LIVE_MILESTONE_TITLES.map(([id]) => id)
    )
  })

  it('promotes all fourteen the moment a verification is reported as passing', () => {
    writeLiveWorkspace(LIVE_WRITTEN_FILES)
    const plan = livePlan()
    const logs: string[] = []

    expect(promoteMilestonesProvenBy(makeDeps(plan, logs), 'npm run build')).toBe(14)
    expect(plan.every((m) => m.status === 'verified')).toBe(true)
    expect(plan[0].notes).toContain('npm run build')
    expect(logs.join('\n')).toContain('14 milestone verificate')
  })

  it('still refuses a milestone whose own file was never written', () => {
    // §6.2.3 is not relaxed by any of this: the terminal check promotes what is on disk and
    // nothing else. Removing `src/components/Sidebar.tsx` must strand m-10 alone.
    writeLiveWorkspace(LIVE_WRITTEN_FILES.filter((f) => f !== 'src/components/Sidebar.tsx'))
    const plan = livePlan()

    const promotable = selectMilestonesAwaitingVerification(makeDeps(plan)).map((m) => m.id)
    expect(promotable).not.toContain('m-10')
    expect(promotable).toHaveLength(13)
  })

  it('promotes nothing when the workspace holds only placeholders', () => {
    // The other half of the same guarantee: files exist, and a passing check over them still
    // proves no milestone, because what they hold is a deferral rather than a deliverable.
    for (const relative of LIVE_WRITTEN_FILES) {
      const full = path.join(tempDir, relative)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, '// TODO: implement this\n')
    }
    const plan = livePlan()

    expect(promoteMilestonesProvenBy(makeDeps(plan), 'npm run build')).toBe(0)
    expect(plan.every((m) => m.status === 'in_progress')).toBe(true)
  })
})
