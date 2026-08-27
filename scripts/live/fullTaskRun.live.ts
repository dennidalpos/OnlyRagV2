/**
 * Live scenario — the whole task, end to end.
 *
 * The prompt is a trimmed version of the one that produced session-1787562597025-q8a5.
 * Re-running it is how a change to the agent loop gets judged against the failure it was meant
 * to fix.
 *
 * It asserts delivery, and it did not always. Until 2026-08-25 the only assertion here was
 * `expect(result).toBeTruthy()`, which the loop satisfies by returning at all: two runs that
 * burned the whole 50-step budget with 0 milestones verified and no `finish` (08:37 and 11:03,
 * both in logs/coding_agent_audit.log) still exited `npm run test:live` with code 0. A probe
 * that cannot go red is not evidence for the numbers the blueprint publishes from it, so the
 * two metrics those numbers are stated in — verified milestones and `finish` — are asserted
 * below against the thresholds that document itself claims.
 *
 * A 7B model does vary run to run, and that variance is now visible instead of absorbed: read
 * the run-metrics block reportRun prints to see how far a red run fell short.
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

/**
 * The bar is the independently reviewed regression baseline for this scenario: 12/13 milestone
 * verificate (92%), `finish` raggiunto autonomamente, `npm run build` con exit code 0.
 *
 * These are deliberately not a "plausible" number picked so the probe would pass. The probe
 * asserts the encoded baseline: if it holds, the run is green; otherwise the agent regressed.
 * Move these constants only after recording a new, independently reviewed baseline.
 */
const RUN9_VERIFIED_MILESTONES = 12
const RUN9_TOTAL_MILESTONES = 13
const MIN_VERIFIED_MILESTONE_RATIO = RUN9_VERIFIED_MILESTONES / RUN9_TOTAL_MILESTONES // 0.923
const RUN9_REACHED_FINISH = true

/**
 * A plan is generated per run, so its size is not fixed and the bar above is a ratio. This
 * floor keeps that ratio meaningful: a run whose plan generation failed has 0 milestones, and
 * 0 verified out of 0 must read as a failure, never as a vacuous pass.
 */
const MIN_PLAN_MILESTONES = 1

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
    const settings = loadRealSettings({ codingModel: 'qwen2.5-coder:7b' })
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

    // Printed BEFORE the assertions on purpose: the first failing expect aborts the test, and
    // the metrics block is what turns "red" into "50/50 steps, 0/13 verified, finish never
    // invoked, 4 commands run".
    const metrics = reportRun({
      label: 'full task run',
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      success: result.success,
      summary: result.summary,
    })

    expect(metrics.milestones.length, 'the run produced no plan at all').toBeGreaterThanOrEqual(
      MIN_PLAN_MILESTONES
    )

    // Milestone status is the agent's own record of what it proved, not the probe's guess:
    // `verified` is only reachable through update_plan or through a verification command that
    // actually passed (agentOrchestratorCircuitBreakerAndVerification.ts).
    expect(
      metrics.verifiedRatio,
      `verified milestones ${metrics.verified}/${metrics.milestones.length} — blueprint §5.6h claims ${RUN9_VERIFIED_MILESTONES}/${RUN9_TOTAL_MILESTONES}`
    ).toBeGreaterThanOrEqual(MIN_VERIFIED_MILESTONE_RATIO)

    // `finish` is the agent declaring the task done and passing the DoD gate, so it is the one
    // signal that separates a delivered task from a session that merely ran out of steps.
    expect(
      metrics.finishClosedSession,
      `finish never closed the session (invoked: ${metrics.finishInvoked}, blocked attempts: ${metrics.finishBlockedAttempts}, steps ${metrics.stepsUsed}/${metrics.maxSteps})`
    ).toBe(RUN9_REACHED_FINISH)
  })
})
