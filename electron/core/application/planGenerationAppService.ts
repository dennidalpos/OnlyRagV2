/**
 * electron/core/application/planGenerationAppService.ts
 *
 * Application Layer — Plan Generation Service
 *
 * Drafts a short implementation plan for the SLM Coding Agent's PLAN approval
 * flow. Replaces the renderer's previous direct `fetch()` call to Ollama
 * (which bypassed hardware-profile-aware runtime options) with a main-process
 * call routed through HardwareProfileResolver, and parses the result through
 * GoalDecompositionPlanner.parsePlanFromText — the same canonical parser the
 * agent orchestrator loop itself uses to extract PlanMilestone[] from model
 * output — so the frontend and backend never disagree on milestone structure.
 */

import os from 'node:os'
import { ollamaAppService } from './ollamaAppService'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { resolveModelContextLength } from '../domain/settings/modelContextPreference'
import { GoalDecompositionPlanner, type PlanMilestone } from '../domain/agent/planAndSolveGraph'
import { MAX_PLAN_MILESTONES } from '../domain/agent/planMilestoneCapper'
import { compilePlanFromText, type WorkspaceScaffoldFacts } from '../domain/agent/planCompilation'
import { resolveVerificationCommands } from '../domain/agent/projectVerificationResolver'
import { readWorkspaceManifest } from '../infrastructure/filesystem/workspaceManifestReader'
import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AppSettings } from '../../../src/types'

// The exact line format below is mandatory, not stylistic: GoalDecompositionPlanner.parsePlanFromText
// (planAndSolveGraph.ts) recognizes "- [ ] text" / "N. text" lines and nested sub-bullets.
// Microtasks ensure Small Language Models (SLMs, 7B/8B) only ever focus on ONE atomic action per turn
// (e.g. 1 file, 1 CLI command, 1 build verification), preventing context overflow and JSON corruption.
//
// Rule 1 is the one this prompt exists for, and it was rewritten on 2026-08-25. The plans this
// prompt used to produce said "create the file X" ten times out of fifteen and never once said what
// the application would then do. A plan of that shape reaches 100% by writing files: measured on
// 2026-08-25, 14/15 milestones verified while `vite build` emitted no JavaScript at all — every
// deliverable present, the application dead (blueprint §5.6c, §5.6f).
//
// The fix is NOT to drop the path. The path is what makes a milestone falsifiable: the deliverable
// probe checks it on disk, milestoneUpdateAuthority refuses `verified` while it is missing, and
// planFalsifiabilityNormalizer FOLDS AWAY any entry that names neither a path nor a command — so a
// milestone written as pure behaviour ("navigation between Dashboard and Tasks works") is deleted
// from the plan before the agent ever sees it. The title therefore carries BOTH: the capability
// first, so the plan states what "done" means, and the path last, so the system can still check it.
const PLAN_SYSTEM_PROMPT =
  "You are an expert AI Coding Assistant and Software Architect. Analyze the user's request and decompose it into a " +
  'strictly sequential, fine-grained Implementation Plan of ATOMIC MICRO-TASKS in MARKDOWN CHECKLIST format.\n\n' +
  'STRICT MICRO-TASK ARCHITECTURE FOR UNIVERSAL COMPATIBILITY (SLMs TO FRONTIER MODELS):\n' +
  '1. EVERY MICRO-TASK STATES WHAT WORKS, THEN NAMES THE FILE THAT MAKES IT WORK. Format: "- [ ] m-N: <what the application can do once this step is done> — `<exact/relative/path.ext>`".\n' +
  '   - WRITE: "- [ ] m-7: The Tasks page lists the tasks and marks one complete — `src/pages/TasksPage.tsx`".\n' +
  '   - DO NOT WRITE: "- [ ] m-7: Create `src/pages/TasksPage.tsx`". A title that only says "create the file" describes a deliverable, not a result, and a plan made of those is finished while the application does not start.\n' +
  '   - The path is MANDATORY on every microtask that produces a file. It is the only proof of that step the system can check, and a microtask without one is folded into the previous step as a criterion.\n' +
  '   - Name a FILE, never a folder. "- [ ] m-1: The project has a clean architecture — `src/services/`" cannot be checked: a folder is not a deliverable, and writing a file inside one creates it. If a layout matters, say so on the file that lives there: "- [ ] m-1: The task service fetches and stores tasks — `src/services/taskService.ts`".\n' +
  '2. ATOMIC DELIVERABLE COHESION (1 FILE / DELIVERABLE = 1 COMPLETE MICRO-TASK): Every single file deliverable MUST be specified as exactly ONE complete milestone (create and configure the file with all required styles/logic in that one step). NEVER split creation and content of the same file into separate microtasks (do NOT write "m-2: Create globals.css" and "m-3: Add Tailwind to globals.css" — write "- [ ] m-2: The app has its Tailwind base styles — `src/styles/globals.css`").\n' +
  '3. PHASE ORDER (3 to 15 granular microtasks — 15 is a HARD LIMIT; anything beyond it is consolidated automatically). Order the microtasks in these phases, and never start a later phase before the earlier one is covered:\n' +
  '   - Phase A — Buildable skeleton: the files without which nothing can compile (`package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`). On an empty workspace these are MANDATORY and come first; see rule 4.\n' +
  '   - Phase B — Wiring: the entrypoint actually loads the application. `index.html` MUST reference the entry script and the entry script (`src/main.tsx`) MUST mount the root component; a page that loads no script compiles to nothing.\n' +
  '   - Phase C — Capabilities: one microtask per file, each stating the behaviour that file delivers.\n' +
  '   - Phase D — Verification: the project runs its own check. If the VERIFICATION COMMANDS block below lists one, cite it verbatim; if it lists none, write no verification microtask — one is appended automatically once the project declares a command.\n' +
  '4. WORKSPACE-AWARE SCOPE:\n' +
  '   - Existing Workspace / Incremental Task: If working in an established project or implementing a specific feature/fix/refactor, target ONLY the relevant files and components requested, and SKIP phases A and B — they are already done. DO NOT re-scaffold existing project infrastructure (`package.json`, `index.html`, `vite.config.ts`, `src/App.tsx`) unless explicitly instructed.\n' +
  '   - Greenfield / Empty Workspace: In an empty workspace where a new application is requested from scratch, the FIRST microtasks MUST establish the buildable project skeleton, one microtask each, before any page or component: `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx`. A plan that starts at the pages leaves the application with no entrypoint, and nothing it builds can ever run.\n' +
  '   - Never write a microtask for reading, inspecting or analysing the workspace: nothing on disk can show it happened, so it is not a step. Do that reading while you write this plan.\n' +
  '5. FALSIFIABILITY & REAL VERIFICATIONS: Each microtask MUST name either an exact relative file path it produces or a command that verifies it. NEVER invent fake or mutating verification commands (e.g. do NOT use `touch`, `echo > file`, `init`, or `mkdir` as verifications). Attach design criteria (e.g. "44x44 tap targets", "responsive layout") directly to the component file they constrain.\n' +
  '6. FORMAT: Output strictly as a checklist in "- [ ] m-N: <capability> — `<exact relative file path>`" format. One item per line. A microtask proven by a command appends the directive "— verify: `<command>`" at the END of its line, copied verbatim from the VERIFICATION COMMANDS block below.\n' +
  '7. CRITICAL LANGUAGE DIRECTIVE: Write the step titles and descriptions in the EXACT same language used by the user in their prompt (e.g. Italian if the user prompt is in Italian, English if English, French if French, etc.).\n' +
  'Output ONLY the markdown checklist lines. No conversational preambles, notes or explanations outside the checklist.'

/**
 * The plan used when the model returns nothing at all. It is also a template: the user reads it
 * in the approval dialog, so it has to demonstrate the shape rule 1 asks for.
 *
 * Three traps from the measured runs are avoided here on purpose. It names no bare directory
 * (`src/` carries no extension, so `extractDeliverablePaths` finds nothing and the milestone
 * becomes unprovable — seven wasted steps in the run of blueprint §5.4). It invents no
 * verification command: `ensureRunnableMilestone` appends the project's own check when the
 * project declares one, and inventing `npm run build` for a workspace that does not declare it
 * is the fabricated proof this codebase keeps removing. And it carries no "analyse the
 * workspace" step: nothing on disk can show that it happened.
 */
const FALLBACK_PLAN_TEXT = (prompt: string, hasExistingProject: boolean = false) => {
  if (hasExistingProject) {
    return (
      `🎯 Piano di Esecuzione per: ${prompt}\n\n` +
      '- [ ] ✏️ m-1: Le modifiche richieste dal task sono implementate nei file del progetto\n' +
      '- [ ] 🛑 m-2: Riepilogo finale dei requisiti e arresto dell agente (invoke "finish")'
    )
  }
  return (
    `🎯 Piano di Esecuzione a Microtask per: ${prompt}\n\n` +
    '- [ ] 📦 m-1: Il progetto dichiara le proprie dipendenze e i propri script — `package.json`\n' +
    '- [ ] 🧩 m-2: La pagina carica lo script di ingresso dell applicazione — `index.html`\n' +
    '- [ ] 🔌 m-3: Lo script di ingresso monta il componente radice nella pagina — `src/main.tsx`\n' +
    '- [ ] 🖼️ m-4: L applicazione mostra il proprio layout e i contenuti richiesti — `src/App.tsx`\n' +
    '- [ ] 🛑 m-5: Riepilogo finale dei requisiti e arresto dell agente (invoke "finish")'
  )
}

export interface PlanGenerationRequest {
  prompt: string
  model?: string
  settings: AppSettings
  /**
   * Non-verified milestones left over from a previous approved plan (residue
   * from an interrupted/finished run). When present, they're folded into the
   * request as reconciliation context so the new plan absorbs prior progress
   * instead of restarting from zero (see C7 / hasPendingUnconsolidatedMilestones).
   */
  pendingResidueMilestones?: PlanMilestone[]
  /**
   * The workspace the plan will run in. Used to resolve the project's real verification
   * commands, so the plan declares proofs the Definition of Done gate can actually execute.
   */
  workspacePath?: string | null
}

export interface PlanGenerationResult {
  planText: string
  milestones: PlanMilestone[]
}

/**
 * Tells the planner which verification commands actually exist, instead of letting it invent
 * them. In session o3tx the model wrote three verification milestones of its own ("Run
 * `npm run build`", "Run `tsc --noEmit`") for a project that declared neither; none of them
 * could ever have run. The commands here are resolved from the workspace's own manifest by
 * projectVerificationResolver — the same resolver the Definition of Done gate executes at
 * finish — so a milestone's declared proof and the gate's actual check are the same string.
 *
 * An empty workspace legitimately offers none. The honest instruction then is that no command
 * exists YET, not a licence to make one up: file-producing microtasks are proven by the paths
 * they write (which the deliverable probe already checks), and only a script the plan itself
 * declares in package.json may be cited later.
 */
function buildVerificationCommandsBlock(workspacePath?: string | null): string {
  const commands = resolveVerificationCommands(readWorkspaceManifest(workspacePath))

  if (commands.length === 0) {
    return (
      '\n\nVERIFICATION COMMANDS AVAILABLE IN THIS PROJECT: NONE.\n' +
      'This workspace declares no runnable verification command yet. You are FORBIDDEN from inventing one: ' +
      '`npm run build`, `npm test` and `tsc --noEmit` DO NOT EXIST here until a microtask creates them.\n' +
      '- Every microtask that produces files is proven by the exact relative paths it writes — name them, and append NO "verify:" directive.\n' +
      '- Only if an earlier microtask of THIS plan explicitly declares a script in `package.json` may a later microtask cite it as "— verify: `npm run <that exact script>`".'
    )
  }

  const list = commands.map((c) => `- \`${c.command}\` (${c.kind}, from ${c.source})`).join('\n')
  return (
    '\n\nVERIFICATION COMMANDS AVAILABLE IN THIS PROJECT (resolved from its manifest — this is the COMPLETE list):\n' +
    `${list}\n` +
    'Any microtask proven by a command MUST cite one of these VERBATIM in its "— verify: `<command>`" directive. ' +
    'You are FORBIDDEN from inventing, renaming or adapting a command that is not listed above. ' +
    'Microtasks that only produce files are proven by the exact relative paths they write and carry no "verify:" directive.'
  )
}

/**
 * The disk facts the plan compiler needs, read here because the domain never touches `fs`.
 *
 * Only the conventional entry pages are looked for. A workspace that keeps its HTML somewhere
 * this does not know about will simply be treated as having none, and the compiler's own guards
 * (the plan already naming an HTML file, the plan naming no web source at all) keep that from
 * producing a wrong step.
 */
function resolveScaffoldFacts(
  workspacePath: string | null | undefined,
  manifest: ReturnType<typeof readWorkspaceManifest>,
  hasManifest: boolean
): WorkspaceScaffoldFacts | null {
  if (!workspacePath) return null
  return {
    hasManifest,
    hasHtmlEntrypoint: ['index.html', 'public/index.html', 'src/index.html'].some((p) => manifest.hasFile(p)),
  }
}

function buildResidueReconciliationBlock(residue?: PlanMilestone[]): string {
  if (!residue || residue.length === 0) return ''
  const items = residue.map((m) => `- [${m.status === 'in_progress' ? '>' : m.status === 'failed' ? '!' : ' '}] ${m.title}`).join('\n')
  return (
    '\n\nCONTESTO DI RICONCILIAZIONE: il piano precedente aveva i seguenti task NON completati:\n' +
    `${items}\n` +
    'Il nuovo piano deve ASSORBIRE questo stato: includi questi task residui (o il lavoro che rappresentano) ' +
    'nel nuovo piano invece di ripartire da zero, salvo indicazione contraria nella richiesta.'
  )
}

export class PlanGenerationAppService {
  /**
   * Generates a draft plan for the given prompt, routed through the hardware
   * profile's Ollama runtime options, and parses it into canonical milestones.
   */
  async generatePlanText(req: PlanGenerationRequest): Promise<PlanGenerationResult> {
    const model = req.model || req.settings.codingModel || req.settings.defaultModel || 'qwen2.5-coder:7b'
    const cachedGpu = getCachedGpuInfo()
    const memInfo = getMemoryInfo()
    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: cachedGpu?.hasNvidiaGpu,
      vramTotalMB: cachedGpu?.vramTotalMB,
      systemRamGB: memInfo?.totalRAMGB,
      cpuCount: os.cpus()?.length,
    })
    runtimeOpts.num_ctx = resolveModelContextLength(model, req.settings.modelContextLengths, runtimeOpts.num_ctx)
    const residueBlock = buildResidueReconciliationBlock(req.pendingResidueMilestones)
    const verificationBlock = buildVerificationCommandsBlock(req.workspacePath)
    const fullPrompt =
      `${PLAN_SYSTEM_PROMPT}${verificationBlock}\n\nGenera un piano d'azione sintetico per il seguente task:\n\n${req.prompt}${residueBlock}`

    let accumulated = ''
    try {
      const res = await ollamaAppService.generateStream(
        model,
        fullPrompt,
        (chunk) => { accumulated += chunk },
        () => {},
        { num_ctx: runtimeOpts.num_ctx, temperature: runtimeOpts.temperature }
      )
      if (!res.success) {
        logger.log('WARN', 'PlanGenerationAppService', `Plan generation failed: ${res.error}`)
      }
    } catch (err: any) {
      logger.log('WARN', 'PlanGenerationAppService', `Plan generation threw: ${err.message}`)
    }

    const manifest = readWorkspaceManifest(req.workspacePath)
    const hasExistingProject = manifest.packageJson !== null || manifest.hasFile('package.json') || manifest.hasFile('pyproject.toml') || manifest.hasFile('Cargo.toml')
    const planText = accumulated.trim() || FALLBACK_PLAN_TEXT(req.prompt, hasExistingProject)
    const parsedMilestones = GoalDecompositionPlanner.parsePlanFromText(planText)
    const milestones = compilePlanFromText(
      planText,
      resolveVerificationCommands(manifest).find((c) => c.coverage === 'whole-project')?.command,
      resolveScaffoldFacts(req.workspacePath, manifest, hasExistingProject)
    )
    if (milestones.length < parsedMilestones.length) {
      logger.log(
        'INFO',
        'PlanGenerationAppService',
        `Plan compiled: ${parsedMilestones.length} raw milestones reduced to ${milestones.length} falsifiable ones (max ${MAX_PLAN_MILESTONES}); acceptance criteria folded into the deliverables they qualify.`
      )
    }
    if (req.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logPlanGeneration('plan-flow', req.prompt, milestones.length, 'plan')
    }
    return { planText, milestones }
  }

  /**
   * Re-parses arbitrary (e.g. user-edited) plan text through the same
   * canonical parser used for generation, so milestones stay in sync
   * after manual edits in the frontend.
   */
  parsePlanText(planText: string, workspacePath?: string | null): PlanMilestone[] {
    // Re-parsing user-edited text must produce the same plan the generator would, including the
    // appended runnable milestone — but only when the caller can say which workspace this is.
    // Without one, no command can be cited and none is invented.
    if (!workspacePath) return compilePlanFromText(planText)

    const manifest = readWorkspaceManifest(workspacePath)
    const hasManifest =
      manifest.packageJson !== null || manifest.hasFile('package.json') || manifest.hasFile('pyproject.toml') || manifest.hasFile('Cargo.toml')
    const verification = resolveVerificationCommands(manifest).find((c) => c.coverage === 'whole-project')?.command
    return compilePlanFromText(planText, verification, resolveScaffoldFacts(workspacePath, manifest, hasManifest))
  }
}

export const planGenerationAppService = new PlanGenerationAppService()
