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

import { ollamaAppService } from './ollamaAppService'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { GoalDecompositionPlanner, type PlanMilestone } from '../domain/agent/planAndSolveGraph'
import { MAX_PLAN_MILESTONES } from '../domain/agent/planMilestoneCapper'
import { compilePlanFromText } from '../domain/agent/planCompilation'
import { logger } from '../../diagnostics'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AppSettings } from '../../../src/types'

// The exact line format below is mandatory, not stylistic: GoalDecompositionPlanner.parsePlanFromText
// (planAndSolveGraph.ts) recognizes "- [ ] text" / "N. text" lines and nested sub-bullets.
// Microtasks ensure Small Language Models (SLMs, 7B/8B) only ever focus on ONE atomic action per turn
// (e.g. 1 file, 1 CLI command, 1 build verification), preventing context overflow and JSON corruption.
const PLAN_SYSTEM_PROMPT =
  "You are an expert AI Coding Assistant and Software Architect. Analyze the user's request and decompose it into a " +
  'strictly sequential, fine-grained Implementation Plan of ATOMIC MICRO-TASKS in MARKDOWN CHECKLIST format.\n\n' +
  'STRICT MICRO-TASK ARCHITECTURE FOR SMALL LANGUAGE MODELS (SLMs):\n' +
  '1. ATOMICITY (1 ACTION = 1 MICRO-TASK): Every single item MUST represent exactly ONE discrete, isolated action (e.g. create a specific file, install dependencies, implement one specific component, run build/typecheck). NEVER bundle multiple files or entire architectural layers into a single broad macro-step.\n' +
  '2. SEQUENTIAL WORKFLOW (5 to 15 granular microtasks — 15 is a HARD LIMIT; anything beyond it is merged automatically and loses its atomicity, so consolidate related actions yourself instead):\n' +
  '   - Scaffolding & Config first: Prefer direct file creation (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`) using write_file, or modern lowercase commands. NEVER generate deprecated commands (e.g. do NOT use `create-react-app`) and NEVER use uppercase project names (e.g. do NOT use `create-react-app ProjectDashboardTask`).\n' +
  '   - Core styles & utilities (e.g. `src/styles/globals.css`, `src/utils/helpers.ts`)\n' +
  '   - Individual discrete UI components (1 component per microtask: e.g. `src/components/Sidebar.tsx`, then `src/components/TaskCard.tsx`)\n' +
  '   - Pages & Views (1 page per microtask: e.g. `src/pages/Dashboard.tsx`, then `src/pages/Tasks.tsx`)\n' +
  '   - Assembly & Integration (e.g. `src/App.tsx`, router wiring)\n' +
  '   - Verification & Quality (e.g. `npm run build`, `tsc --noEmit`, test validation)\n' +
  '   - Final Review & Completion (invoke finish)\n' +
  '3. FALSIFIABILITY (EVERY ITEM MUST BE CHECKABLE): each microtask MUST name either an exact relative file path it produces or a command that verifies it. An item nobody could prove done or not done is NOT a step — it is an acceptance criterion of another step. Never emit "Design the two-column tablet layout", "Ensure buttons are 44x44 px" or "Fix every overflow issue" as items of their own: attach them to the microtask that writes the file they constrain (e.g. "- [ ] m-4: Create `src/components/Sidebar.tsx`; collapsible on tablet, 44x44 px tap targets, no horizontal overflow"). Any item left unfalsifiable is folded into its neighbour automatically.\n' +
  '4. FORMAT: Output strictly as a checklist in "- [ ] m-N: <Action & exact relative file path>" format. One item per line.\n' +
  '5. CRITICAL LANGUAGE DIRECTIVE: Write the step titles and descriptions in the EXACT same language used by the user in their prompt (e.g. Italian if the user prompt is in Italian, English if English, French if French, etc.).\n' +
  'Output ONLY the markdown checklist lines. No conversational preambles, notes or explanations outside the checklist.'

const FALLBACK_PLAN_TEXT = (prompt: string) =>
  `🎯 Piano di Esecuzione a Microtask per: ${prompt}\n\n` +
  // Every item names a file or a command: the fallback plan has to satisfy the same
  // falsifiability rule the generated ones do, or normalizePlanFalsifiability collapses it.
  '- [ ] 📦 m-1: Inizializzazione progetto e dipendenze in `package.json`\n' +
  '- [ ] 📐 m-2: Configurazione degli stili di base e dei design token in `src/styles/globals.css`\n' +
  '- [ ] 🧩 m-3: Creazione dell entrypoint `index.html` e del layout shell `src/App.tsx`\n' +
  '- [ ] ✏️ m-4: Implementazione dei componenti UI e della logica applicativa sotto `src/components/`\n' +
  '- [ ] 🧪 m-5: Verifica di compilazione con `npm run build` e typecheck con `npx tsc --noEmit`\n' +
  '- [ ] 🛑 m-6: Riepilogo finale dei requisiti e arresto dell agente (invoke "finish")'

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
}

export interface PlanGenerationResult {
  planText: string
  milestones: PlanMilestone[]
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
    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(req.settings.hardwareProfile, {
      enableSystemRamOffloading: req.settings.enableSystemRamOffloading,
    })
    const residueBlock = buildResidueReconciliationBlock(req.pendingResidueMilestones)
    const fullPrompt =
      `${PLAN_SYSTEM_PROMPT}\n\nGenera un piano d'azione sintetico per il seguente task:\n\n${req.prompt}${residueBlock}`

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

    const planText = accumulated.trim() || FALLBACK_PLAN_TEXT(req.prompt)
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
