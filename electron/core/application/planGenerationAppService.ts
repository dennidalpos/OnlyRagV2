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
  "Sei un AI Coding Assistant. Analizza la richiesta dell'utente e genera un Piano di Implementazione " +
  'in formato CHECKLIST MARKDOWN, UNA VOCE PER RIGA, in questo esatto formato:\n\n' +
  '- [ ] 🎯 Obiettivo: <breve descrizione>\n' +
  '- [ ] 🔍 Analisi: <analisi e scelta autonoma di librerie/tecnologie standard>\n' +
  '- [ ] ✏️ Modifiche: <creazione o modifica file specifici>\n' +
  '- [ ] 🧪 Verifica: <test, esecuzione o build di convalida>\n\n' +
  'DIRETTIVA AUTONOMIA & CONCRETEZZA TECNICA: Definisci direttamente nel piano le scelte tecnologiche, librerie e file esatti (es. animazioni CSS/JS standard, GSAP CDN, Tailwind, file index.html/App.tsx, avvio a schermo). ' +
  'NON inserire task esplorativi o vaghi che richiederebbero domande all\'utente: crea un piano auto-consistente che l\'agente possa eseguire ininterrottamente fino al 100% di completamento.\n' +
  'Genera 4-6 voci. Non usare paragrafi, titoli separati o testo fuori dalla checklist: SOLO righe nel formato "- [ ] testo".'

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
