import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import { respondToApproval, runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import type { RendererEventSink } from '../../electron/core/domain/ports/rendererEventSink'
import type { AgentApprovalRequest } from '../../shared/types'
import { LIVE_CODING_MODEL, liveWorkspacePath, loadRealSettings, reportRun, resetWorkspace, seedGeneratedPlan } from './agentLiveHarness'
import { managedDevServerRepository } from '../../electron/core/infrastructure/process/managedDevServerRepository'

const MODEL = LIVE_CODING_MODEL
const RUN_LABEL = process.env.ONLYRAG_LIVE_RUN || 'default'
const SAFE_RUN = `${MODEL}-${RUN_LABEL}`.replace(/[^a-z0-9_-]+/gi, '-')
const WORKSPACE = liveWorkspacePath(`fulltask_${SAFE_RUN}`)
const SESSION = `live-full-task-${SAFE_RUN}`

/**
 * Consent a user of the network-approved policy gives: network access (package installs with any
 * flags, web research) and confined workspace edits. Host tool installs and commits stay denied.
 * The probe used to approve only the exact string "npm install", so "npm install --no-audit" was
 * refused and the 2026-09-25 run measured the script rather than the agent.
 */
const CONSENTED_REASONS = new Set(['network_access', 'workspace_mutation'])

const npmConsentEvents: RendererEventSink = {
  isAvailable: () => true,
  send(channel, payload) {
    if (channel !== 'agent:approval-request') return
    const request = payload as AgentApprovalRequest
    const reasons = request.reasons ?? []
    const approved = request.type !== 'git_commit' && reasons.length > 0 && reasons.every((reason) => CONSENTED_REASONS.has(reason))
    console.log(`consent ${approved ? 'approved' : 'denied'} for ${request.type} (${reasons.join(', ') || 'no reason'}): ${request.contentOrCmd.slice(0, 120)}`)
    respondToApproval(request.runId, approved)
  },
}

/** The bar is the independently reviewed regression baseline for this scenario: 12/13 milestone verificate (92%), chiusura raggiunta autonomamente, `npm run build` con exit code 0. */
const RUN9_VERIFIED_MILESTONES = 12
const RUN9_TOTAL_MILESTONES = 13
const MIN_VERIFIED_MILESTONE_RATIO = RUN9_VERIFIED_MILESTONES / RUN9_TOTAL_MILESTONES // 0.923

/** A plan is generated per run, so its size is not fixed and the bar above is a ratio. */
const MIN_PLAN_MILESTONES = 1

function readFirstSequencePrompt(filePath: string): string {
  const source = fs.readFileSync(path.resolve(filePath), 'utf-8')
  const separator = /\r?\n\r?\n-{3,}\r?\n/.exec(source)
  if (!source.startsWith('# 1 -') || !separator || separator.index === 0) {
    throw new Error('The live prompt file must start with task #1 followed by a horizontal separator.')
  }
  return source.slice(0, separator.index)
}

const USER_TASK = process.env.ONLYRAG_LIVE_PROMPT_FILE
  ? readFirstSequencePrompt(process.env.ONLYRAG_LIVE_PROMPT_FILE)
  : `# 1 - Project setup and mobile-first foundation

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
  afterEach(() => managedDevServerRepository.stopAll())

  it('plans and executes the original audit task against a real model', async () => {
    const settings = loadRealSettings({ agentSessionTimeoutMinutes: 180, capabilityPolicyMode: 'network-approved', maxToolCallSteps: 50 })
    const requestedContext = process.env.ONLYRAG_LIVE_CONTEXT_TOKENS
    if (requestedContext !== undefined) {
      const numCtx = Number(requestedContext)
      if (!Number.isSafeInteger(numCtx) || numCtx < 4096) throw new Error('ONLYRAG_LIVE_CONTEXT_TOKENS must be an integer of at least 4096.')
      settings.modelContextLengths = { ...settings.modelContextLengths, [MODEL]: numCtx }
    }
    resetWorkspace(WORKSPACE)

    const seeded = await seedGeneratedPlan({
      sessionId: SESSION,
      workspacePath: WORKSPACE,
      userTask: USER_TASK,
      settings,
    })

    // The interview is the first thing a user sees and the last thing this probe used to exercise.
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
      { userTask: seeded.effectivePrompt, workspacePath: WORKSPACE, agentMode: 'auto', sessionId: SESSION, settings },
      npmConsentEvents,
    )

    // Printed BEFORE the assertions on purpose: the first failing expect aborts the test, and the metrics block is what turns "red" into "50/50 steps, 0/13 verified, blocked, 4 commands run".
    const metrics = reportRun({
      label: `full task run ${MODEL} ${RUN_LABEL}`,
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      success: result.success,
      summary: result.summary,
    })

    expect(metrics.milestones.length, 'the run produced no plan at all').toBeGreaterThanOrEqual(MIN_PLAN_MILESTONES)

    // Milestone status is the agent's own record of what it proved, not the probe's guess: `verified` is only reachable through update_plan or through a verification command that actually passed (agentOrchestratorCircuitBreakerAndVerification.ts).
    expect(
      metrics.verifiedRatio,
      `verified milestones ${metrics.verified}/${metrics.milestones.length} — blueprint §5.6h claims ${RUN9_VERIFIED_MILESTONES}/${RUN9_TOTAL_MILESTONES}`,
    ).toBeGreaterThanOrEqual(MIN_VERIFIED_MILESTONE_RATIO)

    expect(
      metrics.completionStatus,
      `application closure status was ${metrics.completionStatus || 'missing'} after ${metrics.stepsUsed}/${metrics.maxSteps} steps`,
    ).toBe('verified')
  })
})
