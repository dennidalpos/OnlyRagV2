/**
 * electron/core/application/planGenerationAppService.ts
 *
 * Application Layer — Plan Generation Service
 *
 * Drafts a short implementation plan for the SLM Coding Agent's PLAN approval
 * flow. The model returns schema-constrained JSON; Markdown is derived only
 * after validation for the existing UI and persistence contracts.
 */

import os from 'node:os'
import { ollamaAppService } from './ollamaAppService'
import { HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { resolveModelContextLength } from '../../../shared/domain/settings/modelContextPreference'
import { GoalDecompositionPlanner, type PlanMilestone } from '../../../shared/domain/agent/planAndSolveGraph'
import { compilePlanFromText, renderPlanMilestones, type WorkspaceScaffoldFacts } from '../../../shared/domain/agent/planCompilation'
import { resolvePrimaryProfileVerificationTargets } from '../domain/agent/projectProfileVerificationResolver'
import { discoverProjectProfile } from '../infrastructure/filesystem/projectProfileDiscovery'
import { readWorkspaceManifest } from '../infrastructure/filesystem/workspaceManifestReader'
import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AppSettings, PlanGenerationResult, UserInterviewAnswer } from '../../../shared/types'
import {
  planningPhaseResponseSchema,
  renderPlanningResponse,
  toOllamaJsonSchema,
  validateStructuredContent,
} from '../domain/agent/ollamaStructuredResponse'
import { collectProjectPlanningFacts } from './projectPlanningFacts'

const PLAN_SYSTEM_PROMPT = `Create a short, sequential coding plan in the requested JSON shape.
Use one milestone for a small fix and normally three to five for medium work; never exceed fifteen.
Each objective states observable behavior, not merely file creation. Use one file per producing milestone.
Every milestone must have a filePath or an allowed verificationCommand.
For an existing workspace, change only relevant files and do not re-scaffold.
For an empty web workspace, establish build files and entrypoints before features.
Never add analysis or inspection as milestones. Never invent verification commands.
Preserve pending work unless the request supersedes it. Use the request language.`

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
  previousDecisions?: UserInterviewAnswer[]
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
    runtimeOpts.num_predict = Math.min(HardwareProfileResolver.deriveNumPredict(runtimeOpts.num_ctx), 2048)
    const manifest = readWorkspaceManifest(req.workspacePath)
    const discovery = collectProjectPlanningFacts(req.workspacePath, req.prompt, req.previousDecisions)
    const profile = discovery.profile
    const hasExistingProject = Boolean(profile && profile.classification !== 'empty')
    const allowedVerificationCommands = discovery.facts.verificationCommands
    const userContent = JSON.stringify({
      request: req.prompt,
      workspace: req.workspacePath ? (hasExistingProject ? 'existing' : 'empty') : 'unknown',
      projectFacts: discovery.facts,
      allowedVerificationCommands,
      pendingMilestones: req.pendingResidueMilestones?.map(({ id, title, status, notes }) => ({ id, title, status, notes })) || [],
    })

    let responseContent = ''
    let structuredPlanText = ''
    let generationError: string | undefined
    try {
      const response = await ollamaAppService.generateStructured({
        model,
        systemPrompt: PLAN_SYSTEM_PROMPT,
        userContent,
        format: toOllamaJsonSchema(planningPhaseResponseSchema),
        host: req.settings.ollamaHost,
        options: runtimeOpts,
      })
      responseContent = response.content
      if (response.status !== 'complete') {
        generationError = response.error
        logger.log('WARN', 'PlanGenerationAppService', `Plan generation failed: ${generationError}`)
      } else {
        const validated = validateStructuredContent(response.content, planningPhaseResponseSchema)
        if (validated.status === 'invalid') {
          generationError = `Invalid plan response: ${validated.error}`
        } else {
          const inventedCommand = validated.data.milestones
            .map((milestone) => milestone.verificationCommand)
            .find((command) => command && !allowedVerificationCommands.includes(command))
          if (inventedCommand) {
            generationError = `Plan response used an unavailable verification command: ${inventedCommand}`
          } else {
            structuredPlanText = renderPlanningResponse(validated.data)
          }
        }
      }
    } catch (err: any) {
      generationError = err.message || 'Plan generation threw'
      logger.log('WARN', 'PlanGenerationAppService', `Plan generation threw: ${err.message}`)
    }

    const rawPlanText = structuredPlanText.trim()
    if (!generationError && !rawPlanText) {
      generationError = 'Plan generation returned an empty response'
      logger.log('WARN', 'PlanGenerationAppService', generationError)
    }
    const parsedMilestones = GoalDecompositionPlanner.parsePlanFromText(rawPlanText)
    const verification = profile ? resolvePrimaryProfileVerificationTargets(profile)[0]?.command : undefined
    const milestones = generationError ? [] : compilePlanFromText(
      rawPlanText,
      verification,
      resolveScaffoldFacts(req.workspacePath, manifest, hasExistingProject)
    )
    if (!generationError && milestones.length === 0) {
      generationError = 'Plan response contained no executable milestones'
      logger.log('WARN', 'PlanGenerationAppService', generationError)
    }
    if (milestones.length < parsedMilestones.length) {
      logger.log(
        'INFO',
        'PlanGenerationAppService',
        `Plan compiled: ${parsedMilestones.length} raw milestones normalized to ${milestones.length} falsifiable ones; acceptance criteria folded into the deliverables they qualify.`
      )
    }
    if (req.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logPlanGeneration('plan-flow', req.prompt, milestones.length, 'plan')
    }
    return generationError
      ? { status: 'error', planText: responseContent.trim(), milestones, error: generationError }
      : { status: 'success', planText: renderPlanMilestones(milestones), milestones }
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
    const profile = discoverProjectProfile(workspacePath)
    const verification = resolvePrimaryProfileVerificationTargets(profile)[0]?.command
    return compilePlanFromText(planText, verification, resolveScaffoldFacts(workspacePath, manifest, hasManifest))
  }
}

export const planGenerationAppService = new PlanGenerationAppService()
