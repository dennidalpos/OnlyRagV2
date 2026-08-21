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
  "You are an expert AI Coding Assistant. Analyze the user's request and generate a structured Implementation Plan " +
  'in MARKDOWN CHECKLIST format, ONE ITEM PER LINE, strictly adhering to this format:\n\n' +
  '- [ ] 🎯 Goal: <brief description>\n' +
  '- [ ] 🔍 Analysis: <autonomous technical decisions and standard technology selections>\n' +
  '- [ ] ✏️ Implementation: <specific file creations or modifications>\n' +
  '- [ ] 🧪 Verification: <testing, build checks, or preview verification>\n\n' +
  'AUTONOMOUS TECHNICAL SPECIFICATION DIRECTIVE: Define all architectural choices, sensible libraries, and exact filenames (e.g. index.html, App.tsx, standard CSS/JS, build commands) directly in the plan. ' +
  'DO NOT generate vague or exploratory tasks that would require asking questions to the user: produce a complete, self-contained plan that the agent can execute autonomously until 100% completion.\n' +
  'CRITICAL LANGUAGE DIRECTIVE: Write the milestone titles and descriptions in the EXACT same language used by the user in their prompt (e.g. Italian if the user prompt is in Italian, English if English, French if French, Spanish if Spanish, German if German, etc.).\n' +
  'Output 4-6 checklist items. Do not output conversational preambles or paragraphs outside the checklist: ONLY lines in the "- [ ] <text>" format.'

const FALLBACK_PLAN_TEXT = (prompt: string) =>
  `🎯 Piano di Esecuzione per: ${prompt}\n\n` +
  "1. 🔍 Analisi del contesto del progetto e identificazione dei file rilevanti\n" +
  '2. ✏️ Implementazione delle modifiche richieste e refactoring atomico\n' +
  '3. 🧪 Verifica di correttezza tramite build e controlli di tipo'

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
    const runtimeOpts = HardwareProfileResolver.resolveOllamaOptions(req.settings.hardwareProfile)
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
