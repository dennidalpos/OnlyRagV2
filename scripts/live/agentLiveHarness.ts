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
import path from 'node:path'
import type { AppSettings } from '../../src/types'
import type { PlanMilestone } from '../../electron/core/domain/agent/planAndSolveGraph'
import { planGenerationAppService } from '../../electron/core/application/planGenerationAppService'
import {
  agentInterviewAppService,
  type InterviewQuestion,
  type UserInterviewAnswer,
} from '../../electron/core/application/agentInterviewAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'

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

/** The plan state the run actually ended on, read back from the persisted session file. */
export function readFinalMilestones(workspacePath: string, sessionId: string): PlanMilestone[] {
  const statePath = path.join(workspacePath, '.onlyrag', 'sessions', `.agent_state_${sessionId}.json`)
  if (!fs.existsSync(statePath)) return []
  return JSON.parse(fs.readFileSync(statePath, 'utf-8')).planMilestones || []
}

/** One-line-per-fact dump, so a scenario's console output is diffable between runs. */
export function reportRun(args: {
  label: string
  workspacePath: string
  sessionId: string
  success: boolean
  summary?: string
}): void {
  const milestones = readFinalMilestones(args.workspacePath, args.sessionId)
  const verified = milestones.filter((m) => m.status === 'verified').length
  console.log(`\n===== ${args.label} =====`)
  console.log(`success: ${args.success}`)
  console.log(`milestones verified: ${verified}/${milestones.length}`)
  console.log(`summary: ${String(args.summary || '').slice(0, 800)}`)
  console.log('milestones:')
  for (const m of milestones) console.log(`  ${m.id} | ${m.status} | ${(m.notes || '').slice(0, 90)}`)
  console.log('files:')
  for (const f of listWorkspaceFiles(args.workspacePath)) console.log(`  ${f}`)
  console.log(
    '\nThe audit log for this run is logs/coding_agent_audit.log — grep it for the guard you are checking.'
  )
}
