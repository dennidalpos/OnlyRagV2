import os from 'node:os'
import { CODING_MODEL_KEEP_ALIVE, HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { resolveModelContextLength } from '../../../shared/domain/settings/modelContextPreference'
import type { PlanMilestone } from '../../../shared/domain/agent/planAndSolveGraph'
import { compilePlanMilestones } from '../../../shared/domain/agent/planCompilation'
import { resolvePrimaryProfileVerificationTargets } from '../domain/agent/projectProfileVerificationResolver'
import { collectProjectPlanningFacts } from './projectPlanningFacts'
import { logger, getCachedGpuInfo, getMemoryInfo } from '../../diagnostics'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type {
  AgentPlan,
  AppSettings,
  PlanDecision,
  PlanEvidence,
  PlanGenerationResult,
  UserInterviewAnswer,
} from '../../../shared/types'
import {
  planningPhaseResponseSchema,
  toOllamaJsonSchema,
  validateStructuredContent,
  type PlanningPhaseResponse,
} from '../domain/agent/ollamaStructuredResponse'
import { generateStructuredWithRecovery } from './structuredGenerationRecovery'

const PLAN_SYSTEM_PROMPT = `Create a short, sequential coding plan in the requested JSON shape.
Use one intervention for a small fix and normally three to five for medium work; never exceed fifteen.
Return one explicit objective, assumptions, interventions, and superseded prior work.
Each intervention states observable behavior, one file at most, acceptance criteria, and an allowed verification command when available.
Every intervention must have a file path or an allowed verification command.
For an existing workspace, change only relevant files and do not re-scaffold.
For an empty workspace, use only the acceptedGreenfieldStack and scaffold requirements supplied in projectFacts.
Executable verification commands already exist and may be used in verificationCommand. Proposed commands are future checks only and must never be returned as verificationCommand.
Never add analysis or inspection as interventions. Never invent verification commands or project infrastructure.
Carry each pending prior intervention through sourceInterventionId or list it in supersededWork with a reason.
Use the request language.`

export interface PlanGenerationRequest {
  prompt: string
  model?: string
  settings: AppSettings
  previousPlan?: AgentPlan
  workspacePath?: string | null
  previousDecisions?: UserInterviewAnswer[]
}

function decisionsFromAnswers(answers: readonly UserInterviewAnswer[]): PlanDecision[] {
  return answers.map((answer) => ({
    id: answer.questionId,
    statement: `${answer.questionText}: ${answer.selectedOption}`,
    source: answer.provenance === 'accepted_recommendation'
      ? 'accepted_recommendation'
      : answer.provenance === 'unconfirmed_assumption'
        ? 'assumption'
        : 'explicit_user',
  }))
}

function mergeDecisions(previous: readonly PlanDecision[], current: readonly PlanDecision[]): PlanDecision[] {
  const merged = new Map(previous.map((decision) => [decision.id, decision]))
  current.forEach((decision) => merged.set(decision.id, decision))
  return [...merged.values()]
}

function retainEvidence(previousPlan?: AgentPlan): PlanEvidence[] {
  if (!previousPlan) return []
  const retained = new Map(previousPlan.retainedEvidence.map((item) => [item.interventionId, item]))
  previousPlan.milestones
    .filter((item) => item.status === 'verified')
    .forEach((item) => retained.set(item.id, {
      interventionId: item.id,
      summary: item.title,
      verificationReferences: item.verificationReferences
        || [item.verificationCommand, item.notes].filter((value): value is string => Boolean(value)),
    }))
  return [...retained.values()]
}

function reconcilePreviousWork(
  plan: PlanningPhaseResponse,
  previousInterventions: readonly PlanMilestone[]
): string | undefined {
  const openIds = new Set(previousInterventions.filter((item) => item.status !== 'verified').map((item) => item.id))
  const carriedIds = plan.interventions
    .map((item) => item.sourceInterventionId)
    .filter((id): id is string => Boolean(id))
  const supersededIds = plan.supersededWork.map((item) => item.interventionId)
  const accountedIds = new Set([...carriedIds, ...supersededIds])
  const unknownIds = [...accountedIds].filter((id) => !openIds.has(id))
  if (unknownIds.length > 0) return `Plan response referenced unknown prior interventions: ${unknownIds.join(', ')}`
  const missingIds = [...openIds].filter((id) => !accountedIds.has(id))
  if (missingIds.length > 0) return `Plan response dropped pending interventions without superseding them: ${missingIds.join(', ')}`
  return undefined
}

function toMilestones(plan: PlanningPhaseResponse): PlanMilestone[] {
  return plan.interventions.map((intervention) => ({
    id: intervention.id,
    title: intervention.objective,
    status: 'pending',
    filePaths: intervention.filePaths,
    acceptanceCriteria: intervention.acceptanceCriteria,
    verificationCommand: intervention.verificationCommand,
    verificationReferences: intervention.verificationCommand ? [intervention.verificationCommand] : [],
    sourceInterventionId: intervention.sourceInterventionId,
    falsifiableHypothesis: intervention.acceptanceCriteria.join('; '),
  }))
}

export class PlanGenerationAppService {
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
    runtimeOpts.num_predict = HardwareProfileResolver.deriveNumPredict(runtimeOpts.num_ctx, 'plan')
    runtimeOpts.maxContextChars = HardwareProfileResolver.deriveMaxContextChars(runtimeOpts.num_ctx, 'plan')

    const discovery = collectProjectPlanningFacts(req.workspacePath, req.prompt, req.previousDecisions)
    const profile = discovery.profile
    const hasExistingProject = Boolean(profile && profile.classification !== 'empty') || discovery.facts.hasFiles
    const executableVerificationCommands = discovery.facts.verification.executableCommands
    const previousInterventions = req.previousPlan?.milestones || []
    const userContent = JSON.stringify({
      request: req.prompt,
      workspace: req.workspacePath ? (hasExistingProject ? 'existing' : 'empty') : 'unknown',
      projectFacts: discovery.facts,
      executableVerificationCommands,
      previousPlan: req.previousPlan ? {
        objective: req.previousPlan.objective,
        interventions: previousInterventions,
      } : null,
    })

    let structuredPlan: PlanningPhaseResponse | null = null
    let generationError: string | undefined
    try {
      const response = await generateStructuredWithRecovery({
        model,
        systemPrompt: PLAN_SYSTEM_PROMPT,
        userContent,
        format: toOllamaJsonSchema(planningPhaseResponseSchema),
        host: req.settings.ollamaHost,
        keepAlive: CODING_MODEL_KEEP_ALIVE,
        options: runtimeOpts,
      }, (content) => {
        const validated = validateStructuredContent(content, planningPhaseResponseSchema)
        if (validated.status === 'invalid') {
          return { status: 'invalid', error: `Invalid plan response: ${validated.error}` }
        }
        const inventedCommand = validated.data.interventions
          .map((item) => item.verificationCommand)
          .find((command) => command && !executableVerificationCommands.includes(command))
        const error = inventedCommand
          ? `Plan response used an unavailable verification command: ${inventedCommand}`
          : reconcilePreviousWork(validated.data, previousInterventions)
        return error
          ? { status: 'invalid', error }
          : { status: 'valid', data: validated.data }
      })
      if (response.status === 'success') {
        structuredPlan = response.data
      } else {
        generationError = response.error
      }
    } catch (error: any) {
      generationError = error.message || 'Plan generation failed'
    }

    if (generationError) logger.log('WARN', 'PlanGenerationAppService', `Plan generation failed: ${generationError}`)
    const verification = profile ? resolvePrimaryProfileVerificationTargets(profile)[0]?.command : undefined
    const milestones = structuredPlan
      ? compilePlanMilestones(
          toMilestones(structuredPlan),
          verification,
          discovery.scaffold
        )
      : []
    if (!generationError && milestones.length === 0) generationError = 'Plan response contained no executable interventions'

    const previousDecisions = req.previousPlan?.decisions || []
    const answerDecisions = decisionsFromAnswers(req.previousDecisions || [])
    const assumptionDecisions: PlanDecision[] = structuredPlan?.assumptions.map((assumption) => ({
      id: assumption.id,
      statement: assumption.statement,
      source: 'assumption',
      rationale: assumption.rationale,
    })) || []
    const result = {
      objective: structuredPlan?.objective || '',
      decisions: mergeDecisions(previousDecisions, [...answerDecisions, ...assumptionDecisions]),
      retainedEvidence: retainEvidence(req.previousPlan),
      milestones,
      supersededWork: [...(req.previousPlan?.supersededWork || []), ...(structuredPlan?.supersededWork || [])],
    }
    if (req.settings.enableCodingAgentDebugLog) {
      codingAgentLogger.logPlanGeneration('plan-flow', req.prompt, milestones.length, 'plan')
    }
    return generationError
      ? { status: 'error', ...result, error: generationError }
      : { status: 'success', ...result }
  }
}

export const planGenerationAppService = new PlanGenerationAppService()
