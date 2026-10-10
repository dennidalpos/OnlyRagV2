import os from 'node:os'
import { CODING_MODEL_KEEP_ALIVE, HardwareProfileResolver } from '../domain/agent/hardwareProfileResolver'
import { resolveModelContextLength } from '../../../shared/domain/settings/modelContextPreference'
import { resolveModelSamplingOverrides } from '../../../shared/domain/agent/ollamaSamplingOptions'
import type { PlanMilestone } from '../../../shared/domain/agent/planAndSolveGraph'
import { compilePlanMilestones, type WorkspaceScaffoldFacts } from '../../../shared/domain/agent/planCompilation'
import { resolveDeclaredFilePaths } from '../../../shared/domain/agent/milestoneDeliverableResolver'
import { resolvePrimaryProfileVerificationTargets } from '../domain/agent/projectProfileVerificationResolver'
import { collectProjectPlanningFacts } from './projectPlanningFacts'
import { logger } from '../infrastructure/logging/logger'
import { hardwareProbe } from '../infrastructure/diagnostics/hardwareProbe'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { noConfiguredModelMessage, resolveConfiguredModel } from '../../../shared/domain/settings/configuredModel'
import type { AgentPlan, AppSettings, PlanDecision, PlanEvidence, PlanGenerationResult, UserInterviewAnswer } from '../../../shared/types'
import {
  planningPhaseResponseSchema,
  toOllamaJsonSchema,
  validateStructuredContent,
  type PlanningPhaseResponse,
} from '../domain/agent/ollamaStructuredResponse'
import { generateStructuredWithRecovery } from './structuredGenerationRecovery'
import { calculateAvailableOutputTokens } from '../../../shared/domain/agent/contextWindowCalculator'
import { resolveOllamaThinkingPreference, resolveStructuredThinkValue } from '../../../shared/domain/agent/ollamaThinkingPolicy'
import { isCodingAgentDebugPayloadCaptureEnabled } from '../../../shared/domain/agent/codingAgentDebugPolicy'
import { ollamaAppService } from './ollamaAppService'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { reviewPlanRequestCoverage } from './planRequestCoverage'
import { draftRequestLedger } from './requestCoverageLedgerDraft'
import {
  requestCoverageLedgerSchema,
  validateRequestLedger,
  type RequestCoverageLedger,
  type CoverageEvidence,
} from '../../../shared/domain/agent/requestCoverageLedger'

const PLAN_SYSTEM_PROMPT = `Create a short, sequential coding plan in the requested JSON shape.
Use one intervention for a small fix and normally three to five for medium work; never exceed fifteen.
Return one explicit objective, assumptions, interventions, and superseded prior work.
Each intervention states observable behavior, one file at most, acceptance criteria, and an allowed verification command when available.
Every intervention must have a file path or an allowed verification command.
For an existing workspace, change only relevant files and do not re-scaffold.
For an empty workspace, use only the acceptedGreenfieldStack and scaffold requirements supplied in projectFacts.
Keep every requested page, navigation behavior, reusable component and service boundary in explicit acceptance criteria; infrastructure setup alone does not cover the request.
The application supplies a coherent scaffold prerequisite. Plan functional work separately, preserving the user's requested integration scope and deferred integrations.
When those requirements name root index.html and src/main.*, use a compatible web bundler; do not choose Create React App or react-scripts unless the user explicitly requested them.
Executable verification commands already exist and may be used in verificationCommand. Proposed commands are future checks only and must never be returned as verificationCommand.
Never add analysis or inspection as interventions. Never invent verification commands or project infrastructure.
Carry each pending prior intervention through sourceInterventionId or list it in supersededWork with a reason.
The human-confirmed coverage ledger is immutable. Return coverageClaims for every actionable obligation. Evidence IDs are 1-based across intervention acceptance criteria in response order, followed by retainedEvidence in input order. Each claim names its evidenceId, obligationId, exact confirmed subject, global/local scope, targets and exact conditions. Local examples cannot satisfy open global obligations. Statements must explicitly undertake the claimed behavior and scope; a declaration alone cannot supply omitted wording.
Use the request language.`

export interface PlanGenerationRequest {
  operationId?: string
  prompt: string
  confirmedCoverage?: RequestCoverageLedger
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
    source:
      answer.provenance === 'accepted_recommendation'
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
    .forEach((item) =>
      retained.set(`${previousPlan.id}@${previousPlan.version}:${item.id}`, {
        interventionId: `${previousPlan.id}@${previousPlan.version}:${item.id}`,
        summary: item.title,
        verificationReferences: item.verificationReferences || [item.verificationCommand, item.notes].filter((value): value is string => Boolean(value)),
      }),
    )
  return [...retained.values()]
}

function reconcilePreviousWork(plan: PlanningPhaseResponse, previousInterventions: readonly PlanMilestone[]): string | undefined {
  const openIds = new Set(previousInterventions.filter((item) => item.status !== 'verified').map((item) => item.id))
  const carriedIds = plan.interventions.map((item) => item.sourceInterventionId).filter((id): id is string => Boolean(id))
  const supersededIds = plan.supersededWork.map((item) => item.interventionId)
  const accountedIds = new Set([...carriedIds, ...supersededIds])
  const unknownIds = [...accountedIds].filter((id) => !openIds.has(id))
  if (unknownIds.length > 0) return `Plan response referenced unknown prior interventions: ${unknownIds.join(', ')}`
  const missingIds = [...openIds].filter((id) => !accountedIds.has(id))
  if (missingIds.length > 0) return `Plan response dropped pending interventions without superseding them: ${missingIds.join(', ')}`
  return undefined
}

function normalizeFreshPlanReferences(plan: PlanningPhaseResponse, previousInterventions: readonly PlanMilestone[]): PlanningPhaseResponse {
  if (previousInterventions.length > 0) return plan
  return {
    ...plan,
    interventions: plan.interventions.map(({ sourceInterventionId: _ignored, ...intervention }) => intervention),
    supersededWork: [],
  }
}

function incompatibleGreenfieldScaffold(plan: PlanningPhaseResponse, scaffold: WorkspaceScaffoldFacts, request: string): string | undefined {
  if (!scaffold.isGreenfield || /\b(?:create react app|react-scripts)\b/i.test(request)) return undefined
  const requiredPaths = new Set(scaffold.requirements.map((requirement) => requirement.path))
  if (!requiredPaths.has('index.html') || ![...requiredPaths].some((path) => /^src\/main\.[cm]?[jt]sx?$/.test(path))) return undefined
  const incompatible = plan.interventions.find((intervention) =>
    /\b(?:create react app|react-scripts)\b/i.test([intervention.objective, ...intervention.acceptanceCriteria].join(' ')),
  )
  return incompatible
    ? `Plan intervention "${incompatible.objective}" selects Create React App/react-scripts, which does not use the required root index.html and src/main.* entrypoints. Choose a compatible web bundler and keep the scaffold requirements.`
    : undefined
}

function toMilestones(plan: PlanningPhaseResponse): PlanMilestone[] {
  return plan.interventions.map((intervention, index) => ({
    id: `m-${index + 1}`,
    title: intervention.objective,
    status: 'pending',
    filePaths: resolveDeclaredFilePaths({
      title: intervention.objective,
      filePaths: intervention.filePaths,
    }),
    acceptanceCriteria: intervention.acceptanceCriteria,
    verificationCommand: intervention.verificationCommand,
    verificationReferences: intervention.verificationCommand ? [intervention.verificationCommand] : [],
    sourceInterventionId: intervention.sourceInterventionId,
    falsifiableHypothesis: intervention.acceptanceCriteria.join('; '),
  }))
}

function sanitizeVerificationCommands(
  plan: PlanningPhaseResponse,
  executableCommands: readonly string[],
  scaffoldFilePath?: string,
): { plan?: PlanningPhaseResponse; error?: string } {
  const unavailableCommandOnly = plan.interventions.find(
    (item) => item.verificationCommand && !executableCommands.includes(item.verificationCommand) && item.filePaths.length === 0,
  )
  if (unavailableCommandOnly?.verificationCommand && !scaffoldFilePath) {
    return {
      error: `Plan response used an unavailable verification command: ${unavailableCommandOnly.verificationCommand}`,
    }
  }

  return {
    plan: {
      ...plan,
      interventions: plan.interventions.map((item) =>
        item.verificationCommand && !executableCommands.includes(item.verificationCommand)
          ? {
              ...item,
              filePaths: item.filePaths.length > 0 ? item.filePaths : [scaffoldFilePath!],
              verificationCommand: undefined,
            }
          : item,
      ),
    },
  }
}

export class PlanGenerationAppService {
  private operations = new Map<string, AbortController>()

  cancelPlanOperation(id: string): boolean {
    const controller = this.operations.get(id)
    if (!controller) return false
    controller.abort(new Error('Plan generation cancelled'))
    return true
  }

  async generatePlanText(req: PlanGenerationRequest): Promise<PlanGenerationResult> {
    if (req.operationId && (this.operations.has(req.operationId) || this.operations.size >= 32)) {
      return {
        status: 'error',
        objective: '',
        decisions: [],
        retainedEvidence: [],
        milestones: [],
        supersededWork: [],
        error: 'Planning operation already active or capacity exhausted',
      }
    }
    const controller = new AbortController()
    if (req.operationId) this.operations.set(req.operationId, controller)
    try {
      return await this.generateOwnedPlan(req, controller.signal)
    } catch (error: unknown) {
      return { status: 'error', objective: '', decisions: [], retainedEvidence: [], milestones: [], supersededWork: [], error: errorMessage(error) }
    } finally {
      if (req.operationId) this.operations.delete(req.operationId)
    }
  }

  private async generateOwnedPlan(req: PlanGenerationRequest, signal: AbortSignal): Promise<PlanGenerationResult> {
    const model = resolveConfiguredModel('coding', req.settings, req.model)
    if (!model) {
      const previous = req.previousPlan
      return {
        status: 'error',
        objective: previous?.objective || '',
        decisions: [],
        retainedEvidence: [],
        milestones: [],
        supersededWork: [],
        error: noConfiguredModelMessage('coding'),
      }
    }
    const confirmationError = req.confirmedCoverage && validateRequestLedger(req.confirmedCoverage, req.prompt)
    if (confirmationError)
      return {
        status: 'error',
        objective: '',
        decisions: [],
        retainedEvidence: [],
        milestones: [],
        supersededWork: [],
        error: confirmationError,
      }
    const confirmedCoverage = req.confirmedCoverage ? requestCoverageLedgerSchema.parse(req.confirmedCoverage) : undefined
    const cachedGpu = hardwareProbe.getCachedGpuInfo()
    const memInfo = hardwareProbe.getMemoryInfo()
    const runtimeOpts = {
      ...HardwareProfileResolver.resolveOllamaOptions('Auto', {
        hasGpu: cachedGpu?.hasNvidiaGpu,
        vramTotalMB: cachedGpu?.vramTotalMB,
        systemRamGB: memInfo?.totalRAMGB,
        cpuCount: os.cpus()?.length,
      }),
      ...resolveModelSamplingOverrides(model, req.settings.modelSamplingOverrides),
    }
    const trainedContext = await ollamaAppService.getModelContextLength(model, req.settings.ollamaHost)
    signal.throwIfAborted()
    const modelMetrics = await ollamaAppService.getModelMetrics(req.settings.ollamaHost)
    signal.throwIfAborted()
    runtimeOpts.num_ctx = resolveModelContextLength(model, req.settings.modelContextLengths, runtimeOpts.num_ctx, trainedContext)
    runtimeOpts.num_predict = HardwareProfileResolver.deriveNumPredict(runtimeOpts.num_ctx)
    runtimeOpts.maxContextChars = HardwareProfileResolver.deriveMaxContextChars(runtimeOpts.num_ctx)

    const discovery = collectProjectPlanningFacts(req.workspacePath, req.prompt, req.previousDecisions)
    const profile = discovery.profile
    const hasExistingProject = Boolean(profile && profile.classification !== 'empty') || discovery.facts.hasFiles
    const executableVerificationCommands = discovery.facts.verification.executableCommands
    const previousInterventions = req.previousPlan?.milestones || []
    const userContent = JSON.stringify({
      request: req.prompt,
      confirmedCoverage,
      retainedEvidence: retainEvidence(req.previousPlan),
      workspace: req.workspacePath ? (hasExistingProject ? 'existing' : 'empty') : 'unknown',
      projectFacts: discovery.facts,
      executableVerificationCommands,
      previousPlan: req.previousPlan
        ? {
            objective: req.previousPlan.objective,
            interventions: previousInterventions,
          }
        : null,
    })
    runtimeOpts.num_predict = calculateAvailableOutputTokens(`${PLAN_SYSTEM_PROMPT}\n${userContent}`, runtimeOpts.num_ctx)

    let structuredPlan: PlanningPhaseResponse | null = null
    let compiledMilestones: PlanMilestone[] = []
    const retained = retainEvidence(req.previousPlan)
    const confirmedDecisions = mergeDecisions(req.previousPlan?.decisions || [], decisionsFromAnswers(req.previousDecisions || []))
      .filter((decision) => decision.source !== 'assumption')
      .map((decision) => decision.statement)
    const verification =
      (profile ? resolvePrimaryProfileVerificationTargets(profile)[0]?.command : undefined) || discovery.facts.verification.proposedCommands[0]
    let generationError: string | undefined
    try {
      const request = {
        operationId: req.operationId,
        model,
        systemPrompt: PLAN_SYSTEM_PROMPT,
        userContent,
        format: toOllamaJsonSchema(planningPhaseResponseSchema),
        think: resolveStructuredThinkValue(resolveOllamaThinkingPreference(model, req.settings, modelMetrics)),
        host: req.settings.ollamaHost,
        keepAlive: CODING_MODEL_KEEP_ALIVE,
        options: runtimeOpts,
      }
      if (!confirmedCoverage) {
        const scopeDraft = await draftRequestLedger(request, req.prompt, confirmedDecisions)
        signal.throwIfAborted()
        return {
          status: 'scope_confirmation_required',
          scopeDraft,
          objective: '',
          decisions: [],
          retainedEvidence: retained,
          milestones: [],
          supersededWork: [],
        }
      }
      const response = await generateStructuredWithRecovery(request, async (content) => {
        signal.throwIfAborted()
        const validated = validateStructuredContent(content, planningPhaseResponseSchema)
        if (validated.status === 'invalid') {
          return {
            status: 'invalid',
            error: `Invalid plan response: ${validated.error}`,
          }
        }
        const freshPlan = normalizeFreshPlanReferences(validated.data, previousInterventions)
        const sanitized = sanitizeVerificationCommands(freshPlan, executableVerificationCommands, discovery.scaffold.requirements[0]?.path)
        const error =
          sanitized.error ||
          incompatibleGreenfieldScaffold(sanitized.plan || freshPlan, discovery.scaffold, req.prompt) ||
          reconcilePreviousWork(sanitized.plan || freshPlan, previousInterventions)
        if (error) return { status: 'invalid', error }
        const candidate = compilePlanMilestones(toMilestones(sanitized.plan!), verification, discovery.scaffold)
        const evidence: CoverageEvidence[] = [
          ...sanitized.plan!.interventions.flatMap((item) =>
            item.acceptanceCriteria.map((statement) => ({
              source: 'planned' as const,
              interventionId: item.id,
              statement,
            })),
          ),
          ...retained.map((item) => ({
            source: 'retained' as const,
            interventionId: item.interventionId,
            statement: `${item.summary}: ${item.verificationReferences.join('; ')}`,
          })),
        ].map((item, index) => ({ ...item, id: index + 1 }))
        const coverageError = await reviewPlanRequestCoverage(
          request,
          confirmedCoverage,
          evidence,
          sanitized.plan!.coverageClaims,
          confirmedDecisions,
          candidate,
        )
        signal.throwIfAborted()
        if (coverageError) return { status: 'invalid', error: coverageError }
        compiledMilestones = candidate
        return { status: 'valid', data: sanitized.plan! }
      })
      signal.throwIfAborted()
      if (response.status === 'success') {
        structuredPlan = response.data
      } else {
        generationError = response.error
      }
    } catch (error: unknown) {
      generationError = errorMessage(error) || 'Plan generation failed'
    }

    if (generationError) logger.log('WARN', 'PlanGenerationAppService', `Plan generation failed: ${generationError}`)
    const milestones = structuredPlan ? compiledMilestones : []
    if (!generationError && milestones.length === 0) generationError = 'Plan response contained no executable interventions'

    const previousDecisions = req.previousPlan?.decisions || []
    const answerDecisions = decisionsFromAnswers(req.previousDecisions || [])
    const assumptionDecisions: PlanDecision[] =
      structuredPlan?.assumptions.map((assumption, index) => ({
        id: `a-${index + 1}`,
        statement: assumption.statement,
        source: 'assumption',
        rationale: assumption.rationale,
      })) || []
    const result = {
      objective: structuredPlan?.objective || '',
      decisions: mergeDecisions(previousDecisions, [...answerDecisions, ...assumptionDecisions]),
      retainedEvidence: retained,
      milestones,
      supersededWork: [...(req.previousPlan?.supersededWork || []), ...(structuredPlan?.supersededWork || [])],
    }
    if (req.settings.enableCodingAgentDebugLog) {
      const auditSessionId = req.operationId || `plan-flow-${Date.now()}`
      codingAgentLogger.configureRetention(req.settings.codingAgentDebugRetentionFiles || 2)
      codingAgentLogger.logSessionStart(
        auditSessionId,
        req.prompt,
        'guided',
        req.model || req.settings.codingModel || req.settings.defaultModel || 'default',
        req.workspacePath,
        isCodingAgentDebugPayloadCaptureEnabled(req.settings),
      )
      codingAgentLogger.logPlanGeneration(auditSessionId, req.prompt, milestones.length, 'guided')
      if (confirmedCoverage) codingAgentLogger.logRequestCoverage(auditSessionId, JSON.stringify(confirmedCoverage))
      const auditSucceeded = !generationError && milestones.length > 0
      codingAgentLogger.logSessionEnd(
        auditSessionId,
        0,
        auditSucceeded,
        auditSucceeded ? `Generated ${milestones.length} milestones.` : `Plan generation failed: ${generationError || 'no executable milestones'}`,
      )
    }
    return generationError ? { status: 'error', ...result, error: generationError } : { status: 'success', ...result }
  }
}

export const planGenerationAppService = new PlanGenerationAppService()
