/**
 * Shared plumbing for live agent runs.
 *
 * A live run drives `runAgentOrchestratorLoop` exactly as the renderer does, but with no
 * Electron window and no UI: the orchestrator accepts `win: null`, and every repository that
 * needs `app.getPath('userData')` already falls back to `<cwd>/userdata_dev` outside Electron.
 * That makes the whole agent loop observable from a terminal, which is how the guards added in
 * docs/coding-agent-studio-blueprint.md §5 were verified.
 *
 * Three things are easy to get wrong here, and each one silently produces a run that proves
 * nothing:
 *
 *  1. Settings are NOT loaded from disk by the orchestrator. `buildDefaultAgentSettings()` is
 *     used whenever the payload carries none, and its default model is `llama3.2` — which is
 *     not an installed tag, so every turn 404s and the session burns its whole step budget
 *     doing nothing. `loadRealSettings()` below reads the same file the app uses.
 *  2. A plan does not appear by itself, and the UI's flow is FOUR steps, not two:
 *     `agent:plan-interview` -> `agent:plan-enrich-prompt` -> `agent:plan-generate` ->
 *     `agent:plan-seed`, and only then the agent runs against the same sessionId. A run
 *     without that sequence executes with no plan at all; a run that skips only the first two
 *     steps executes against a prompt no user would have submitted (see seedGeneratedPlan).
 *  3. Anything under `electron/**` matching `*.test.ts` is collected by the normal suite. Live
 *     scenarios therefore live here, are named `*.live.ts`, and run under
 *     vitest.live.config.mts.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../../src/types'
import type { PlanMilestone } from '../../electron/core/domain/agent/planAndSolveGraph'
import type { SavedAgentSessionState } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { planGenerationAppService } from '../../electron/core/application/planGenerationAppService'
import {
  agentInterviewAppService,
  type InterviewQuestion,
  type UserInterviewAnswer,
} from '../../electron/core/application/agentInterviewAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../../electron/core/infrastructure/logging/codingAgentLogger'

const LIVE_RUN_SNAPSHOT_ROOT = path.join(os.homedir(), 'Desktop', 'onlyrag_live_snapshots')

/**
 * Copies both audit-log generations before a later run or workspace cleanup can remove them.
 * The destination is deliberately outside the repository and app log directories: clean_workspace.ps1
 * may remove either source, but must not erase the evidence produced by an earlier live run.
 */
export function snapshotLiveAuditLogs(args: {
  sessionId: string
  label: string
  sourceLogPath?: string
  destinationRoot?: string
}): string {
  const sourceLogPath = args.sourceLogPath || codingAgentLogger.getLogFilePath()
  const sourceDir = path.dirname(sourceLogPath)
  const sourceFiles = [sourceLogPath, path.join(sourceDir, 'coding_agent_audit.1.log')].filter((filePath) =>
    fs.existsSync(filePath)
  )
  if (sourceFiles.length === 0) {
    throw new Error(`No coding agent audit log found for live run ${args.sessionId} at ${sourceDir}`)
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeLabel = args.label.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'run'
  const runDir = path.join(args.destinationRoot || LIVE_RUN_SNAPSHOT_ROOT, `${timestamp}_${args.sessionId}_${safeLabel}`)
  fs.mkdirSync(runDir, { recursive: true })
  for (const sourceFile of sourceFiles) fs.copyFileSync(sourceFile, path.join(runDir, path.basename(sourceFile)))
  fs.writeFileSync(
    path.join(runDir, 'manifest.json'),
    JSON.stringify({ sessionId: args.sessionId, label: args.label, capturedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  )
  return runDir
}

/** The settings file the packaged app writes, so a live run uses the model you actually use. */
export function loadRealSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
  const settingsPath = path.join(appData, 'onlyrag-v2', 'settings.json')
  if (!fs.existsSync(settingsPath)) {
    throw new Error(
      `No settings at ${settingsPath}. Run the app once, or pass an explicit settings object to the scenario.`
    )
  }
  return { ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')), ...overrides } as AppSettings
}

/** Empties a workspace directory without deleting the directory itself (it may be open elsewhere). */
export function resetWorkspace(workspacePath: string): void {
  fs.mkdirSync(workspacePath, { recursive: true })
  for (const entry of fs.readdirSync(workspacePath)) {
    fs.rmSync(path.join(workspacePath, entry), { recursive: true, force: true })
  }
}

/**
 * How the harness answers the clarification interview, since no human is present.
 *
 * `recommended` takes the option the model itself marked as the best default, which is what a
 * user clicking through the wizard most often does. `skip` bypasses the interview entirely and
 * reproduces the OLD harness behaviour — kept only so a scenario can isolate the difference.
 */
export type InterviewPolicy = 'recommended' | 'skip'

export interface SeededPlan {
  milestones: PlanMilestone[]
  /** The prompt the planner actually saw: the original, plus any confirmed decisions. */
  effectivePrompt: string
  questions: InterviewQuestion[]
  answers: UserInterviewAnswer[]
}

/**
 * Reproduces the UI's plan flow END TO END, which is four steps and not two.
 *
 * The renderer calls `agent:plan-interview`, `agent:plan-enrich-prompt`, `agent:plan-generate`
 * and `agent:plan-seed`, in that order. This harness used to call only the third and fourth,
 * so the planner received the RAW prompt and every live run measured a flow no user executes.
 *
 * It matters for what the runs then show. In the observed sessions the model invented its own
 * router, its own postcss setup and its own folder layout, and several of the rewrite loops
 * started exactly there — those are the choices the interview exists to settle before a single
 * milestone is drafted.
 *
 * The interview is genuinely optional: `conductInterview` answers `hasQuestions: false` for a
 * request it considers already well-scoped, and also whenever the model's JSON cannot be
 * repaired. Both cases fall through to the original prompt, so a scenario never blocks on it.
 */
export async function seedGeneratedPlan(args: {
  sessionId: string
  workspacePath: string
  userTask: string
  settings: AppSettings
  /** Defaults to 'recommended': the flow a user actually walks through. */
  interviewPolicy?: InterviewPolicy
}): Promise<SeededPlan> {
  const policy = args.interviewPolicy || 'recommended'
  const model = args.settings.codingModel

  let questions: InterviewQuestion[] = []
  let answers: UserInterviewAnswer[] = []
  let effectivePrompt = args.userTask

  if (policy !== 'skip') {
    const interview = await agentInterviewAppService.conductInterview(args.userTask, model, args.settings)
    questions = interview.questions
    answers = questions.map((q) => ({
      questionId: q.id,
      questionText: q.question,
      selectedOption: q.options[q.recommendedIndex],
    }))
    effectivePrompt = agentInterviewAppService.enrichPromptWithAnswers(args.userTask, answers)
  }

  const plan = await planGenerationAppService.generatePlanText({
    prompt: effectivePrompt,
    model,
    settings: args.settings,
    workspacePath: args.workspacePath,
  })

  // The ENRICHED prompt is seeded as the session's task, not the original: the orchestrator
  // replays it every turn, and a plan drafted against decisions the agent never sees would
  // have it re-deciding them mid-run.
  await agentSessionStateRepository.seedPlanMilestones(
    args.sessionId,
    args.workspacePath,
    plan.milestones,
    effectivePrompt
  )

  return { milestones: plan.milestones, effectivePrompt, questions, answers }
}

/** Every file in the workspace with its size, excluding the noise directories. */
export function listWorkspaceFiles(workspacePath: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(`${path.relative(workspacePath, full).replace(/\\/g, '/')} (${fs.statSync(full).size}b)`)
    }
  }
  walk(workspacePath)
  return out.sort()
}

/**
 * The state the orchestrator itself persisted for this run.
 *
 * Written by `persistCurrentState()` in agentOrchestratorSessionPersistence.ts — on the first
 * step, every fifth step, after every mutating tool call, and unconditionally on every exit
 * path — so the file on disk always describes the run that just ended. It is the only
 * observation channel a scenario needs: step budget, tool trajectory and plan state are all
 * projections of it, and reading it costs nothing.
 */
function readSessionState(workspacePath: string, sessionId: string): Partial<SavedAgentSessionState> {
  const statePath = path.join(workspacePath, '.onlyrag', 'sessions', `.agent_state_${sessionId}.json`)
  if (!fs.existsSync(statePath)) return {}
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Partial<SavedAgentSessionState>
  } catch {
    // A half-written file means the run died mid-persist; an empty state reports as 0/0 and
    // fails any scenario that asserts delivery, which is the honest outcome.
    return {}
  }
}

/** The plan state the run actually ended on, read back from the persisted session file. */
export function readFinalMilestones(workspacePath: string, sessionId: string): PlanMilestone[] {
  return readSessionState(workspacePath, sessionId).planMilestones || []
}

/**
 * The orchestrator's own end-of-loop summaries, returned ONLY when the model never closed
 * the session itself (agentOrchestratorAppService.ts, end of `runAgentOrchestratorLoop`).
 * `handleFinishTool` returns the model's report instead — or `Task completed successfully.`
 * when the call carried none — so these two literals separate "the loop ran out" from
 * "the agent said it was done".
 */
const STEP_CEILING_SUMMARY = /^Raggiunto il limite massimo di passaggi configurato/
const LOOP_STOPPED_SUMMARY = /^Completed \d+ agent steps\.$/

/**
 * What a run actually delivered, in the two dimensions the blueprint's §5.6h numbers are
 * stated in — verified milestones and `finish` — plus the context needed to read a red run.
 *
 * Everything here comes from the persisted session state above and from the summary the loop
 * returned. Nothing parses logs/coding_agent_audit.log: that file is append-only and shared
 * between runs (docs/agent-live-testing.md §2), so per-run assertions built on it would be
 * reading someone else's session.
 */
export interface LiveRunMetrics {
  stepsUsed: number
  maxSteps: number
  /** The 50-step ceiling reached with nothing delivered is the failure shape of 2026-08-25. */
  hitStepCeiling: boolean
  milestones: PlanMilestone[]
  verified: number
  failed: number
  pending: number
  /** 0 when the run has no plan at all, so an empty plan can never read as 100%. */
  verifiedRatio: number
  /** True if `finish` was emitted at all, including attempts the DoD gate intercepted. */
  finishInvoked: boolean
  /** Interceptions by the DoD / verification gates in agentOrchestratorFinishAndLoopGuards.ts. */
  finishBlockedAttempts: number
  /** True only when `finish` was ACCEPTED and it was the call that ended the session. */
  finishClosedSession: boolean
  /** `run_command` calls, in order, as `[step N] STATUS command`. */
  commands: string[]
  toolCalls: number
  failedToolCalls: number
}

/** Reads the two delivery metrics — verified milestones and `finish` — plus their context. */
export function readRunMetrics(args: {
  workspacePath: string
  sessionId: string
  success: boolean
  summary?: string
}): LiveRunMetrics {
  const state = readSessionState(args.workspacePath, args.sessionId)
  const milestones = state.planMilestones || []
  // Capped at 100 entries by EpisodicMemoryCompactor.recordStep; the step ceiling these
  // scenarios run under is 50, so nothing observed here has been evicted yet.
  const episodes = state.episodes || []
  const summary = String(args.summary || '')

  const verified = milestones.filter((m) => m.status === 'verified').length
  const failed = milestones.filter((m) => m.status === 'failed').length
  const finishEpisodes = episodes.filter((e) => e.tool === 'finish')
  const stepsUsed = state.stepCount || 0
  const maxSteps = state.maxSteps || 0

  // An ACCEPTED finish leaves no episode behind: recordStep is called only on the gate's
  // BLOCKED branches (agentOrchestratorFinishAndLoopGuards.ts), and the accepting branch
  // returns straight out of the loop. The returned summary is the trace it does leave.
  const finishClosedSession =
    args.success && !STEP_CEILING_SUMMARY.test(summary) && !LOOP_STOPPED_SUMMARY.test(summary)

  return {
    stepsUsed,
    maxSteps,
    hitStepCeiling: maxSteps > 0 && stepsUsed >= maxSteps,
    milestones,
    verified,
    failed,
    pending: milestones.length - verified - failed,
    verifiedRatio: milestones.length > 0 ? verified / milestones.length : 0,
    finishInvoked: finishClosedSession || finishEpisodes.length > 0,
    finishBlockedAttempts: finishEpisodes.filter((e) => e.status === 'BLOCKED').length,
    finishClosedSession,
    commands: episodes
      .filter((e) => e.tool === 'run_command')
      .map((e) => `[step ${e.step}] ${e.status} ${e.target || '(no command recorded)'}`),
    toolCalls: episodes.length,
    failedToolCalls: episodes.filter((e) => e.status === 'FAILURE' || e.status === 'BLOCKED').length,
  }
}

/**
 * One-line-per-fact dump, so a scenario's console output is diffable between runs.
 *
 * Returns the metrics it printed. A scenario asserts on THIS object rather than reading the
 * state file a second time, so the numbers a failure is judged on are the same ones the dump
 * above it shows — and the dump is printed before any assertion runs, so a red run still says
 * how red it is.
 */
export function reportRun(args: {
  label: string
  workspacePath: string
  sessionId: string
  success: boolean
  summary?: string
}): LiveRunMetrics {
  const metrics = readRunMetrics(args)
  console.log(`\n===== ${args.label} =====`)
  console.log(`success: ${args.success}`)
  console.log(`milestones verified: ${metrics.verified}/${metrics.milestones.length}`)
  console.log(`summary: ${String(args.summary || '').slice(0, 800)}`)
  console.log('milestones:')
  for (const m of metrics.milestones) console.log(`  ${m.id} | ${m.status} | ${(m.notes || '').slice(0, 90)}`)
  console.log('files:')
  for (const f of listWorkspaceFiles(args.workspacePath)) console.log(`  ${f}`)

  console.log(`\n----- ${args.label}: run metrics -----`)
  console.log(
    `steps: ${metrics.stepsUsed}/${metrics.maxSteps}${metrics.hitStepCeiling ? ' (CEILING REACHED)' : ''}`
  )
  console.log(
    `milestones: ${metrics.verified} verified / ${metrics.failed} failed / ${metrics.pending} pending ` +
      `of ${metrics.milestones.length} (${Math.round(metrics.verifiedRatio * 100)}%)`
  )
  console.log(
    `finish: ${metrics.finishClosedSession ? 'REACHED (closed the session)' : metrics.finishInvoked ? 'attempted but never accepted' : 'NEVER INVOKED'}` +
      ` — blocked attempts: ${metrics.finishBlockedAttempts}`
  )
  console.log(`tool calls: ${metrics.toolCalls} (${metrics.failedToolCalls} failed or blocked)`)
  console.log(`commands executed: ${metrics.commands.length}`)
  for (const c of metrics.commands) console.log(`  ${c}`)

  const snapshotDir = snapshotLiveAuditLogs({ sessionId: args.sessionId, label: args.label })
  console.log(`audit snapshot: ${snapshotDir}`)

  console.log(
    '\nThe audit log for this run is logs/coding_agent_audit.log — grep it for the guard you are checking.'
  )
  return metrics
}
