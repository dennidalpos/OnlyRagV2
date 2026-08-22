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
import { logger } from '../../diagnostics'
import type { AppSettings } from '../../../src/types'

// The exact line format below is mandatory, not stylistic: GoalDecompositionPlanner.parsePlanFromText
// (planAndSolveGraph.ts) only recognizes "- [ ] text" / "N. text" lines. A prompt that only
// describes the desired tone (as this one used to) lets a local model answer with prose and bold
// section headers instead, which the parser cannot turn into milestones -- the plan tab then has
// nothing to render but raw text. The inline example is here because local models follow a shown
// format far more reliably than a described one.
const PLAN_SYSTEM_PROMPT =
  "You are an expert AI Coding Assistant. Analyze the user's request and generate a strictly sequential, single-responsibility Implementation Plan " +
  'in MARKDOWN CHECKLIST format, ONE ITEM PER LINE, strictly adhering to this format:\n\n' +
  '- [ ] 📦 Step 1: Scaffolding & Toolchain Setup (<initialization, package.json, dependencies, build config>)\n' +
  '- [ ] 📐 Step 2: Architecture & Foundation (<base styles, design tokens, entrypoint layout shell>)\n' +
  '- [ ] 🧩 Step 3: Core Implementation (<specific discrete components, pages, services or business logic>)\n' +
  '- [ ] 🧪 Step 4: Verification & Quality (<build execution, typecheck, test runner validation>)\n' +
  '- [ ] 🛑 Step 5: Final Review & Report (<validation of all user criteria, usage instructions, invoke finish>)\n\n' +
  'CRITICAL MICRO-STEP DIRECTIVES:\n' +
  '1. FLAT CHECKLIST ONLY: Output 4-6 flat checklist items in "- [ ] <text>" format. NEVER use nested sub-bullet lists (no indented dashes or sub-tasks).\n' +
  '2. ACTIONABLE & SEQUENTIAL: Each step must be a concrete, isolated action. Step 1 MUST always be scaffolding/setup if the project requires initialization. Step 4 MUST always be verification. Step 5 MUST always be final review/finish.\n' +
  '3. AUTONOMOUS SPECIFICATION: Specify exact file paths (e.g. package.json, src/App.tsx, src/components/Sidebar.tsx) and standard libraries directly in the items.\n' +
  '4. CRITICAL LANGUAGE DIRECTIVE: Write the step titles and descriptions in the EXACT same language used by the user in their prompt (e.g. Italian if the user prompt is in Italian, English if English, French if French, Spanish if Spanish, German if German, etc.).\n' +
  'Output ONLY the markdown checklist lines. No conversational preambles or explanations outside the checklist.'

const FALLBACK_PLAN_TEXT = (prompt: string) =>
  `🎯 Piano di Esecuzione per: ${prompt}\n\n` +
  '- [ ] 📦 Step 1: Inizializzazione progetto e configurazione dipendenze\n' +
  '- [ ] 📐 Step 2: Architettura di base, layout shell e stili\n' +
  '- [ ] ✏️ Step 3: Implementazione componenti, pagine e logica applicativa\n' +
  '- [ ] 🧪 Step 4: Verifica di compilazione, build e controlli di tipo\n' +
  '- [ ] 🛑 Step 5: Revisione finale dei requisiti e chiusura del task'

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
    const milestones = GoalDecompositionPlanner.parsePlanFromText(planText)
    return { planText, milestones }
  }

  /**
   * Re-parses arbitrary (e.g. user-edited) plan text through the same
   * canonical parser used for generation, so milestones stay in sync
   * after manual edits in the frontend.
   */
  parsePlanText(planText: string): PlanMilestone[] {
    return GoalDecompositionPlanner.parsePlanFromText(planText)
  }
}

export const planGenerationAppService = new PlanGenerationAppService()
