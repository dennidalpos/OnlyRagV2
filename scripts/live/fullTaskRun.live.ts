/**
 * Live scenario — the whole task, end to end.
 *
 * The prompt is a trimmed version of the one that produced session-1787562597025-q8a5, the run
 * the audit in docs/coding-agent-studio-blueprint.md is built on. Re-running it is how a change
 * to the agent loop gets judged against the failure it was meant to fix.
 *
 * This is an observation, not an assertion. A 7B model varies run to run: one pass produced a
 * green `vite build`, the next did not. Read the console dump and the audit log; do not expect
 * a stable pass/fail.
 *
 *   npm run test:live
 *   npx vitest run --config vitest.live.config.mts -t "full task"
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { loadRealSettings, reportRun, resetWorkspace, seedGeneratedPlan } from './agentLiveHarness'

const WORKSPACE = path.join(os.homedir(), 'Desktop', 'onlyrag_live_fulltask')
const SESSION = 'live-full-task'

const USER_TASK = `# 1 - Project setup and mobile-first foundation

Create a new application called Project Dashboard Task using React and Tailwind CSS.

Design the application using a mobile-first approach from the very beginning. Every page and component must be fully responsive instead of adapting a desktop layout later.

Set up a clean architecture with:
- Dashboard page
- Tasks page
- Reusable UI components
- Services folder for future integrations

Responsive requirements:

- Use Tailwind CSS mobile-first utilities.
- Use responsive breakpoints (sm, md, lg, xl).
- Buttons must have a minimum touch target of 44x44 px.

Navigation:
- Desktop: left sidebar.
- Mobile: hamburger menu with slide-out drawer.

Build a fully working first version containing:
- Dashboard page
- Tasks page
- Basic task cards
- Working navigation between pages

Ensure the application is fully runnable, usable and responsive before moving to the next step.`

describe('live: full task run', () => {
  it('plans and executes the original audit task against a real model', async () => {
    const settings = loadRealSettings()
    resetWorkspace(WORKSPACE)

    const seeded = await seedGeneratedPlan({
      sessionId: SESSION,
      workspacePath: WORKSPACE,
      userTask: USER_TASK,
      settings,
    })

    // The interview is the first thing a user sees and the last thing this probe used to
    // exercise. Printed in full: the choices it settles are the ones the model otherwise
    // invents mid-run, and they are the readable difference between two runs of this scenario.
    console.log(`\nclarification interview: ${seeded.questions.length} question(s)`)
    for (const [i, q] of seeded.questions.entries()) {
      console.log(`  Q${i + 1} ${q.question}`)
      for (const [oi, opt] of q.options.entries()) {
        console.log(`      ${oi === q.recommendedIndex ? '>' : ' '} ${opt}`)
      }
      console.log(`      answered: ${seeded.answers[i]?.selectedOption}`)
    }

    console.log(`\nplan (${seeded.milestones.length} milestones):`)
    for (const m of seeded.milestones) {
      console.log(`  ${m.id} | verify=${m.verificationCommand || '-'} | ${m.title}`)
    }

    // The SAME prompt the plan was drafted against. Passing the raw task here instead would
    // have the agent re-deciding, every turn, what the interview already settled.
    const result = await runAgentOrchestratorLoop(
      { userTask: seeded.effectivePrompt, workspacePath: WORKSPACE, agentMode: 'agent', sessionId: SESSION, settings },
      null
    )

    reportRun({
      label: 'full task run',
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      success: result.success,
      summary: result.summary,
    })

    // The run must complete without throwing; what it produced is for the reader to judge.
    expect(result).toBeTruthy()
  })
})
