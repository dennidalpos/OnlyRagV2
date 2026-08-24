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
 *  2. A plan does not appear by itself. The UI generates it (`agent:plan-generate`), seeds it
 *     into session state (`agent:plan-seed`), and only then starts the agent against the same
 *     sessionId. A run without that sequence executes with no plan at all.
 *  3. Anything under `electron/**` matching `*.test.ts` is collected by the normal suite. Live
 *     scenarios therefore live here, are named `*.live.ts`, and run under
 *     vitest.live.config.mts.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../../src/types'
import type { PlanMilestone } from '../../electron/core/domain/agent/planAndSolveGraph'
import { planGenerationAppService } from '../../electron/core/application/planGenerationAppService'
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
 * Reproduces the UI's plan flow: generate with the coding model, then seed the milestones into
 * session state so the orchestrator's restore path picks them up for the same sessionId.
 */
export async function seedGeneratedPlan(args: {
  sessionId: string
  workspacePath: string
  userTask: string
  settings: AppSettings
}): Promise<PlanMilestone[]> {
  const plan = await planGenerationAppService.generatePlanText({
    prompt: args.userTask,
    model: args.settings.codingModel,
    settings: args.settings,
    workspacePath: args.workspacePath,
  })
  await agentSessionStateRepository.seedPlanMilestones(
    args.sessionId,
    args.workspacePath,
    plan.milestones,
    args.userTask
  )
  return plan.milestones
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
