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
import { GoalDecompositionPlanner, type PlanMilestone } from '../domain/agent/planAndSolveGraph'
import { MAX_PLAN_MILESTONES } from '../domain/agent/planMilestoneCapper'
import { compilePlanFromText } from '../domain/agent/planCompilation'
import { resolveVerificationCommands } from '../domain/agent/projectVerificationResolver'
import { readWorkspaceManifest } from '../infrastructure/filesystem/workspaceManifestReader'
import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AppSettings } from '../../../src/types'

// The exact line format below is mandatory, not stylistic: GoalDecompositionPlanner.parsePlanFromText
// (planAndSolveGraph.ts) recognizes "- [ ] text" / "N. text" lines and nested sub-bullets.
// Microtasks ensure Small Language Models (SLMs, 7B/8B) only ever focus on ONE atomic action per turn
// (e.g. 1 file, 1 CLI command, 1 build verification), preventing context overflow and JSON corruption.
const PLAN_SYSTEM_PROMPT =
  "You are an expert AI Coding Assistant and Software Architect. Analyze the user's request and decompose it into a " +
  'strictly sequential, fine-grained Implementation Plan of ATOMIC MICRO-TASKS in MARKDOWN CHECKLIST format.\n\n' +
  'STRICT MICRO-TASK ARCHITECTURE FOR UNIVERSAL COMPATIBILITY (SLMs TO FRONTIER MODELS):\n' +
  '1. ATOMIC DELIVERABLE COHESION (1 FILE / DELIVERABLE = 1 COMPLETE MICRO-TASK): Every single file deliverable MUST be specified as exactly ONE complete milestone (e.g. create and configure the file with all required styles/logic). NEVER split creation and content of the same file into separate microtasks (do NOT create "m-2: Create globals.css" and "m-3: Add Tailwind to globals.css" — write "- [ ] m-2: Create and configure `src/styles/globals.css`").\n' +
  '2. WORKSPACE-AWARE SCOPE (3 to 15 granular microtasks — 15 is a HARD LIMIT; anything beyond it is consolidated automatically):\n' +
  '   - Existing Workspace / Incremental Task: If working in an established project or implementing a specific feature/fix/refactor, target ONLY the relevant files and components requested. DO NOT re-scaffold existing project infrastructure (`package.json`, `index.html`, `vite.config.ts`, `src/App.tsx`) unless explicitly instructed.\n' +
  '   - Greenfield / Empty Workspace: In an empty workspace where a new application is requested from scratch, the first microtasks MUST establish the buildable project skeleton (`package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `src/App.tsx`, `src/main.tsx`).\n' +
  '   - Global Verification: Run real build/typecheck (e.g. `npm run build` or `npx tsc --noEmit` or tests).\n' +
  '   - Final Review & Completion (invoke finish).\n' +
  '3. FALSIFIABILITY & REAL VERIFICATIONS: Each microtask MUST name either an exact relative file path it produces or a command that verifies it. NEVER invent fake or mutating verification commands (e.g. do NOT use `touch`, `echo > file`, `init`, or `mkdir` as verifications). Attach design criteria (e.g. "44x44 tap targets", "responsive layout") directly to the component file they constrain.\n' +
  '4. FORMAT: Output strictly as a checklist in "- [ ] m-N: <Action & exact relative file path>" format. One item per line. A microtask proven by a command appends the directive "— verify: `<command>`" at the END of its line, copied verbatim from the VERIFICATION COMMANDS block below.\n' +
  '5. CRITICAL LANGUAGE DIRECTIVE: Write the step titles and descriptions in the EXACT same language used by the user in their prompt (e.g. Italian if the user prompt is in Italian, English if English, French if French, etc.).\n' +
  'Output ONLY the markdown checklist lines. No conversational preambles, notes or explanations outside the checklist.'

const FALLBACK_PLAN_TEXT = (prompt: string, hasExistingProject: boolean = false) => {
  if (hasExistingProject) {
    return (
      `🎯 Piano di Esecuzione per: ${prompt}\n\n` +
      '- [ ] 🔍 m-1: Analisi del codice sorgente e identificazione dei file rilevanti\n' +
      '- [ ] ✏️ m-2: Esecuzione delle modifiche e implementazione dei requisiti richiesti\n' +
      '- [ ] 🧪 m-3: Verifica della correttezza tramite build o test di progetto\n' +
      '- [ ] 🛑 m-4: Riepilogo finale dei requisiti e arresto dell agente (invoke "finish")'
    )
  }
  return (
    `🎯 Piano di Esecuzione a Microtask per: ${prompt}\n\n` +
    '- [ ] 📦 m-1: Inizializzazione progetto e configurazione di base in `package.json`\n' +
    '- [ ] 🧩 m-2: Creazione dell entrypoint `index.html` e del layout shell `src/App.tsx`\n' +
    '- [ ] ✏️ m-3: Implementazione dei componenti UI e della logica applicativa sotto `src/`\n' +
    '- [ ] 🧪 m-4: Verifica di compilazione con `npm run build` e typecheck con `npx tsc --noEmit`\n' +
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
    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(req.settings.hardwareProfile, {
      hasGpu: cachedGpu?.hasNvidiaGpu,
      vramTotalMB: cachedGpu?.vramTotalMB,
      systemRamGB: memInfo?.totalRAMGB,
      cpuCount: os.cpus()?.length,
      enableSystemRamOffloading: req.settings.enableSystemRamOffloading,
    })
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
    const milestones = compilePlanFromText(planText)
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
  parsePlanText(planText: string): PlanMilestone[] {
    return compilePlanFromText(planText)
  }
}

export const planGenerationAppService = new PlanGenerationAppService()
