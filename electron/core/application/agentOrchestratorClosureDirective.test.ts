import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolvePlanDirectiveForTurn } from './agentOrchestratorCircuitBreakerAndVerification'
import { handleLoopDetection } from './agentOrchestratorFinishAndLoopGuards'
import { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import { TransactionalExecutionGuard } from '../domain/agent/transactionalExecutionGuard'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import type { AppSettings } from '../../../src/types'
import type { ResponseInterpreterContext } from './agentOrchestratorResponseInterpreterTypes'

/**
 * Blueprint §5.4 symptom A: in the ERESOLVE probe the model re-ran a `npm run build` that was
 * already green four times instead of closing. The guard told it the command had ALREADY
 * SUCCEEDED and it ran it again — not out of confusion, but because the plan block forbade
 * finishing while a milestone naming no artefact stayed open, and re-running the build was the
 * only permitted action left.
 *
 * These tests pin the exit: once the verification has passed and nothing is left that a
 * command could prove, the system says so and names the two calls that end the session.
 */

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-closure-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function plannerWith(milestones: Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'verified' | 'failed' }>) {
  const planner = new GoalDecompositionPlanner()
  planner.initializePlan(milestones)
  return planner
}

/**
 * The two directives these tests were written against are now branches of one arbitrated
 * decision (planDirectiveArbiter.ts). The adapters keep each assertion asking the question it
 * was written to ask: "is THIS the directive the turn carries?" — which is stricter than the
 * old "is this directive non-null?", because the arbiter can only ever return one.
 */
function closureDirectiveOf(workspace: string | null, planner: GoalDecompositionPlanner, hasVerifiedBuild: boolean): string | null {
  const decision = resolvePlanDirectiveForTurn(workspace, planner, hasVerifiedBuild)
  return decision.kind === 'session_closure' ? decision.blockDirective : null
}

function unprovableDirectiveOf(workspace: string | null, planner: GoalDecompositionPlanner): string | null {
  const decision = resolvePlanDirectiveForTurn(workspace, planner, false)
  return decision.kind === 'unprovable_milestone' ? decision.closureStepDirective : null
}

describe('the session-closure branch of the plan directive arbiter', () => {
  it('says nothing while the build has not been verified', () => {
    const planner = plannerWith([{ id: 'm-1', title: 'Ensure every button has a 44x44 touch target', status: 'in_progress' }])
    expect(closureDirectiveOf(tempDir, planner, false)).toBeNull()
  })

  it('says nothing without a workspace to probe', () => {
    const planner = plannerWith([{ id: 'm-1', title: 'Ensure every button has a 44x44 touch target', status: 'in_progress' }])
    expect(closureDirectiveOf(null, planner, true)).toBeNull()
  })

  it('says nothing while a milestone still names a file that was never written', () => {
    const planner = plannerWith([
      { id: 'm-1', title: 'Create `src/pages/Tasks.tsx`', status: 'in_progress' },
      { id: 'm-2', title: 'Run the application', status: 'pending' },
    ])
    expect(closureDirectiveOf(tempDir, planner, true)).toBeNull()
  })

  it('names the unprovable milestone and the way out once the build is green', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'App.tsx'), 'export default function App() { return null }\n')

    const planner = plannerWith([
      { id: 'm-1', title: 'Create `src/App.tsx`', status: 'verified' },
      { id: 'm-2', title: 'Ensure every button has a 44x44 touch target', status: 'in_progress' },
    ])

    const directive = closureDirectiveOf(tempDir, planner, true)!
    expect(directive).toContain('m-2: Ensure every button has a 44x44 touch target')
    expect(directive).toContain('update_plan')
    expect(directive).toContain('"finish"')
  })
})

/**
 * The exact milestone from the live-full-task run of 2026-08-24. m-10 was "Create
 * `src/services` folder"; the model wrote `src/services/index.tsx` three times with three
 * different placeholder bodies trying to close it, because focus directive 2 said writing the
 * milestone's files was how closure happened.
 */
describe('the unprovable-milestone branch of the plan directive arbiter', () => {
  it('fires on the folder milestone that caused the observed loop', () => {
    const planner = plannerWith([{ id: 'm-10', title: 'Create `src/services` folder', status: 'in_progress' }])

    const directive = unprovableDirectiveOf(tempDir, planner)!

    expect(directive).toContain('NAMES NO FILE')
    expect(directive).toContain('"m-10"')
  })

  // Writing a file into the folder does not change the verdict, which is the whole point:
  // three writes later the milestone was still exactly as closeable as before.
  it('still fires after the model has written a file into that folder', () => {
    fs.mkdirSync(path.join(tempDir, 'src', 'services'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'services', 'index.tsx'), 'export default {}\n')
    const planner = plannerWith([{ id: 'm-10', title: 'Create `src/services` folder', status: 'in_progress' }])

    expect(unprovableDirectiveOf(tempDir, planner)).not.toBeNull()
  })

  it('stays silent for a milestone that names a file which is still missing', () => {
    const planner = plannerWith([{ id: 'm-3', title: 'Create `src/App.tsx`', status: 'in_progress' }])

    expect(unprovableDirectiveOf(tempDir, planner)).toBeNull()
  })

  it('stays silent for a milestone whose file is on disk', () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'App.tsx'), 'export default function App() { return null }\n')
    const planner = plannerWith([{ id: 'm-3', title: 'Create `src/App.tsx`', status: 'in_progress' }])

    expect(unprovableDirectiveOf(tempDir, planner)).toBeNull()
  })

  // The finish tool owns the completion milestone; telling the model to update_plan it would
  // drive the checklist to 100% before the report is written.
  it('stays silent on the completion milestone', () => {
    const planner = plannerWith([{ id: 'm-15', title: 'Final Review & Completion (invoke finish)', status: 'pending' }])

    expect(unprovableDirectiveOf(tempDir, planner)).toBeNull()
  })

  it('stays silent without a workspace to probe', () => {
    const planner = plannerWith([{ id: 'm-10', title: 'Create `src/services` folder', status: 'in_progress' }])

    expect(unprovableDirectiveOf(null, planner)).toBeNull()
  })

  // Observed on m-5 "Install Tailwind CSS" in the live run of 2026-08-24: the milestone names
  // no file, but `update_plan` runs its declared command and promotes on the exit code, so
  // "no command can prove it" was false and the directive was pushing the model off a real check.
  it('stays silent for a milestone that declares its own verification command', () => {
    const planner = new GoalDecompositionPlanner()
    planner.initializePlan([
      {
        id: 'm-5',
        title: 'Install Tailwind CSS',
        status: 'in_progress',
        verificationCommand: 'npm install tailwindcss postcss autoprefixer',
      },
    ] as never)

    expect(unprovableDirectiveOf(tempDir, planner)).toBeNull()
  })
})

describe('handleLoopDetection — a repeat after a green build gets a way out, not another refusal', () => {
  const buildCall: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run build' } }

  let ctx: ResponseInterpreterContext
  let loopDetector: AgentActionLoopDetector
  let recordedDirectives: string[]

  function makeContext(hasVerifiedBuild: boolean): ResponseInterpreterContext {
    loopDetector = new AgentActionLoopDetector(2)
    recordedDirectives = []
    return {
      streamedOutput: '',
      agentMode: 'agent',
      stepCount: 30,
      maxSteps: 50,
      isUnlimitedSteps: false,
      workspacePath: tempDir,
      settings: { enableCodingAgentDebugLog: false } as unknown as AppSettings,
      sessionId: 'session-closure-test',
      hasRecentToolFailure: false,
      errorCountInHistory: 0,
      compiledHistoryBlock: '',
      flags: { hasFileMutations: true, hasVerifiedBuild, currentOverriddenModel: null },
      surfacedDodReasons: new Set<string>(),
      state: { noToolStreak: 0, schemaRejectionStreak: 0, stagnationStreak: 0, redundantSuccessStreak: 0, verificationFixCycles: 0 },
      episodicCompactor: {
        recordStep: (_step: unknown, directive?: string) => {
          if (directive) recordedDirectives.push(directive)
        },
        getEpisodes: () => [],
      } as unknown as ResponseInterpreterContext['episodicCompactor'],
      goalPlanner: plannerWith([
        { id: 'm-1', title: 'Create `src/App.tsx`', status: 'verified' },
        { id: 'm-2', title: 'Ensure the layout is responsive on small screens', status: 'in_progress' },
      ]),
      executionGuard: new TransactionalExecutionGuard(tempDir),
      loopDetector,
      emitLog: () => {},
      emitDone: () => {},
      persistCurrentState: async () => {},
      finalizeSession: () => {},
      buildSessionTracker: (() => ({})) as unknown as ResponseInterpreterContext['buildSessionTracker'],
    }
  }

  /** Mirrors the orchestrator turn: guard first, tool afterwards, outcome reported last. */
  const runStep = async (call: AgentToolCall, succeeded: boolean) => {
    const outcome = await handleLoopDetection(ctx, call)
    if (outcome === null) loopDetector.recordOutcome(call, succeeded)
    return outcome
  }

  beforeEach(() => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'src', 'App.tsx'), 'export default function App() { return null }\n')
  })

  it('tells the model to close the session instead of only refusing the repeated build', async () => {
    ctx = makeContext(true)

    await runStep(buildCall, true)
    await runStep(buildCall, true)
    await runStep(buildCall, true)

    const lastDirective = recordedDirectives[recordedDirectives.length - 1]
    expect(lastDirective).toContain('PROJECT VERIFIED — CLOSE THE SESSION')
    expect(lastDirective).toContain('m-2: Ensure the layout is responsive on small screens')
  })

  /**
   * The live eresolve run of 2026-08-24 is the reason this is pinned. The closure directive
   * fired at exactly the right step, third in a message whose earlier blocks said "move to the
   * NEXT unfinished step of your active milestone" and "Advance to the next unfinished step
   * instead". The model followed those and ran another command. One message, one instruction.
   */
  it('carries no competing "go do more work" advice alongside the order to finish', async () => {
    ctx = makeContext(true)

    await runStep(buildCall, true)
    await runStep(buildCall, true)
    await runStep(buildCall, true)

    const lastDirective = recordedDirectives[recordedDirectives.length - 1]
    expect(lastDirective).not.toContain('move to the NEXT unfinished step')
    expect(lastDirective).not.toContain('Advance to the next unfinished step')
    expect(lastDirective).not.toContain('REDUNDANCY DIRECTIVE')
  })

  // The same text replaces the stagnation branch, which is reached by repeats that FAILED.
  // The live run of 2026-08-24 put it on an `update_plan` rejected twice for having no plan,
  // under a sentence claiming it "succeeded every time".
  it('does not claim the repeated call succeeded, since it also answers failing repeats', async () => {
    ctx = makeContext(true)
    const failingCall: AgentToolCall = { tool: 'update_plan', parameters: { milestoneId: 'm-2' } }

    await runStep(failingCall, false)
    await runStep(failingCall, false)
    await runStep(failingCall, false)
    await runStep(failingCall, false)

    const lastDirective = recordedDirectives[recordedDirectives.length - 1]
    expect(lastDirective).toContain('CLOSE THE SESSION')
    expect(lastDirective).not.toContain('succeeded every time')
  })

  // Escalation would mark the very milestones the directive is asking the model to close as
  // FAILED, putting "fallita" in the final report for work that was done.
  it('does not abandon a milestone while telling the model the session is finished', async () => {
    ctx = makeContext(true)

    for (let i = 0; i < 10; i++) await runStep(buildCall, true)

    expect(ctx.goalPlanner.getMilestones().map((m) => m.status)).not.toContain('failed')
  })

  // The freshness rule still governs: a write after the build makes it stale evidence, and a
  // session with unverified changes on disk must not be told it may close.
  it('stays silent about closing when the build is stale', async () => {
    ctx = makeContext(false)

    await runStep(buildCall, true)
    await runStep(buildCall, true)
    await runStep(buildCall, true)

    const lastDirective = recordedDirectives[recordedDirectives.length - 1]
    expect(lastDirective).toContain('ALREADY SUCCEEDED')
    expect(lastDirective).not.toContain('CLOSE THE SESSION')
  })
})

/**
 * Regression found by the live run of 2026-08-24, once the arbiter made the model actually run
 * commands: a repeated `npm run build` abandoned m-1 "Create `package.json`" as FAILED — a file
 * written correctly at step 1 and on disk the whole time. The escape must not punish a
 * milestone for an error that belongs to the build.
 */
describe('a repeated command must not abandon a milestone that is already delivered', () => {
  function contextFor(planner: GoalDecompositionPlanner): ResponseInterpreterContext {
    return {
      streamedOutput: '',
      agentMode: 'agent',
      stepCount: 20,
      maxSteps: 50,
      isUnlimitedSteps: false,
      workspacePath: tempDir,
      settings: { enableCodingAgentDebugLog: false } as unknown as AppSettings,
      sessionId: 'session-command-loop-test',
      hasRecentToolFailure: false,
      errorCountInHistory: 0,
      compiledHistoryBlock: '',
      flags: { hasFileMutations: true, hasVerifiedBuild: false, currentOverriddenModel: null },
      surfacedDodReasons: new Set<string>(),
      state: { noToolStreak: 0, schemaRejectionStreak: 0, stagnationStreak: 0, redundantSuccessStreak: 0, verificationFixCycles: 0 },
      episodicCompactor: { recordStep: () => {}, getEpisodes: () => [] } as unknown as ResponseInterpreterContext['episodicCompactor'],
      goalPlanner: planner,
      executionGuard: new TransactionalExecutionGuard(tempDir),
      loopDetector: new AgentActionLoopDetector(2),
      emitLog: () => {},
      emitDone: () => {},
      persistCurrentState: async () => {},
      finalizeSession: () => {},
      buildSessionTracker: (() => ({})) as unknown as ResponseInterpreterContext['buildSessionTracker'],
    }
  }

  function writeWorkspaceFile(rel: string, body: string) {
    const abs = path.join(tempDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body, 'utf-8')
  }

  /** Repeats one identical call until the stagnation ladder reaches its structural escape. */
  async function repeatUntilEscape(call: AgentToolCall, planner: GoalDecompositionPlanner) {
    const ctx = contextFor(planner)
    for (let i = 0; i < 8; i++) await handleLoopDetection(ctx, call)
  }

  const buildCall = { tool: 'run_command', parameters: { command: 'npm run build' } } as AgentToolCall

  it('leaves the milestone alone when the repeat is a build and its file is on disk', async () => {
    writeWorkspaceFile('package.json', '{ "name": "x", "scripts": { "build": "vite build" } }')
    const planner = plannerWith([{ id: 'm-1', title: 'Create `package.json`', status: 'in_progress' }])

    await repeatUntilEscape(buildCall, planner)

    expect(planner.getMilestones().find((m) => m.id === 'm-1')!.status).not.toBe('failed')
  })

  it('still abandons a milestone whose own file was never written', async () => {
    const planner = plannerWith([{ id: 'm-1', title: 'Create `src/never-written.tsx`', status: 'in_progress' }])

    await repeatUntilEscape(buildCall, planner)

    expect(planner.getMilestones().find((m) => m.id === 'm-1')!.status).toBe('failed')
  })

  it('still abandons on a repeated write to the milestone own file', async () => {
    writeWorkspaceFile('src/App.tsx', 'export default function App() { return null }\n')
    const planner = plannerWith([{ id: 'm-1', title: 'Create `src/App.tsx`', status: 'in_progress' }])

    await repeatUntilEscape(
      { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: 'x' } } as AgentToolCall,
      planner
    )

    expect(planner.getMilestones().find((m) => m.id === 'm-1')!.status).toBe('failed')
  })
})
