import type { AgentApprovalPayload, AgentCompletionEvidence, AgentCompletionStatus, AgentVerificationEvidence, AppSettings } from '../../../shared/types'
import { isCompletionMilestoneTitle, type GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { decideVerificationGate } from '../domain/agent/verificationGatePolicy'
import { agentSessionStateRepository, type AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { agentToolExecutorService } from './agentToolExecutorService'
import { promoteMilestonesProvenBy } from './agentOrchestratorCircuitBreakerAndVerification'
import { runProjectVerification, type VerificationRunResult } from './agentOrchestratorVerificationRunner'
import type { ResponseInterpreterState } from './agentOrchestratorRunContext'
import type { EmitLog } from './agentOrchestratorTypes'
import type { ToolResultMutableFlags } from './agentOrchestratorRunContext'
import type { ApplicationClosureOutcome, ApplicationClosureRequest, ApplicationClosureTrigger } from './agentOrchestratorApplicationClosureTypes'
import type { AgentExecutionPhase } from '../domain/agent/agentExecutionPhase'
import { MAX_FAILURES_PER_RECOVERY_CATEGORY } from '../domain/agent/recoveryBudget'
import { MAX_VERIFICATION_FIX_CYCLES } from '../domain/agent/verificationGatePolicy'
import type { OllamaGenerationTelemetry, OllamaSessionRuntimeProfile } from '../domain/agent/ollamaSessionRuntime'
import { redactSecrets } from '../../logRedactor'
import type { DisposableAgentWorkspace } from '../infrastructure/filesystem/disposableAgentWorkspace'
import type { ApprovalResponse } from './agentOrchestratorTypes'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import { recordGuardEvent } from '../domain/agent/agentGuardEvents'
import {
  type AgentLocalizedLine,
  type AgentLocalizedText,
  type AgentMainTextKey,
  formatAgentTextIt,
  renderAgentLines,
} from '../../../shared/domain/agent/agentMainText'

export interface ApplicationClosureContext {
  workspacePath: string | null
  settings: AppSettings
  sessionId: string
  stepCount: number
  flags: ToolResultMutableFlags
  state: ResponseInterpreterState
  goalPlanner: GoalDecompositionPlanner
  episodicCompactor: EpisodicMemoryCompactor
  isSessionActive: () => boolean
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string, completionStatus?: AgentCompletionStatus, evidence?: AgentCompletionEvidence) => void
  persistCurrentState: (terminationReason?: AgentSessionTerminationReason, completionStatus?: AgentCompletionStatus) => Promise<void>
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  finalizeSession: () => void
  setExecutionPhase: (phase: AgentExecutionPhase) => void
  getExecutionPhase?: () => AgentExecutionPhase
  runtimeProfile?: OllamaSessionRuntimeProfile
  generationTelemetry?: readonly OllamaGenerationTelemetry[]
  lastVerification?: AgentVerificationEvidence
  recordVerificationEvidence?: (evidence: AgentVerificationEvidence) => void
  nonRollbackEffects?: readonly string[]
  requestApproval?: (approvalPayload: AgentApprovalPayload) => Promise<ApprovalResponse>
  workspaceTransaction?: DisposableAgentWorkspace
  signal?: AbortSignal
}

function toVerificationEvidence(run: VerificationRunResult): AgentVerificationEvidence {
  return {
    status: run.status === 'unverifiable' ? 'unavailable' : run.status,
    checkedAt: new Date().toISOString(),
    command: run.command,
    evidenceLevel: run.evidenceLevel,
    detail: run.failureDetail ? redactSecrets(run.failureDetail) : undefined,
  }
}

/** `guard×count` per guard and action, in first-firing order, e.g. `loop_exact_repeat×2, no_mutation(stop)`. */
function summarizeGuardEvents(events: ResponseInterpreterState['guardEvents']): string {
  const counts = new Map<string, number>()
  for (const event of events) {
    const key = event.action === 'advise' ? event.guard : `${event.guard}(${event.action})`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts].map(([key, count]) => (count > 1 ? `${key}×${count}` : key)).join(', ')
}

/** The session diagnostics as localizable lines; the Italian rendering is the log detail. */
function diagnosticLines(
  ctx: ApplicationClosureContext,
  request: ApplicationClosureRequest,
  status: AgentCompletionStatus,
  verification?: AgentVerificationEvidence,
): AgentLocalizedLine[] {
  const unavailable: AgentLocalizedText = { key: 'diagnosticUnavailable' }
  const notAvailable: AgentLocalizedText = { key: 'diagnosticNotAvailableShort' }
  const runtime = ctx.runtimeProfile
  const latest = ctx.generationTelemetry?.at(-1)
  const lines: AgentLocalizedLine[] = [
    { key: 'diagnosticPhase', params: { phase: ctx.getExecutionPhase?.() || unavailable } },
    { key: 'diagnosticStatus', params: { status } },
    { key: 'diagnosticStopReason', params: { reason: request.reason } },
    { key: 'diagnosticVerification', params: { status: verification?.status || { key: 'diagnosticVerificationNotRun' } } },
  ]
  if (verification?.command) lines.push({ key: 'diagnosticCommand', params: { command: verification.command } })
  if (verification?.evidenceLevel) lines.push({ key: 'diagnosticEvidenceLevel', params: { level: verification.evidenceLevel } })
  if (verification?.detail) lines.push({ key: 'diagnosticVerificationDetail', params: { detail: verification.detail } })
  lines.push(
    { key: 'diagnosticSchemaRecovery', params: { used: ctx.state.progress.schemaFailuresSpent ?? 0, limit: MAX_FAILURES_PER_RECOVERY_CATEGORY } },
    { key: 'diagnosticExecutionRecovery', params: { used: ctx.state.progress.executionFailuresSpent ?? 0, limit: MAX_FAILURES_PER_RECOVERY_CATEGORY } },
    { key: 'diagnosticVerificationFixes', params: { used: ctx.state.verificationFixCycles ?? 0, limit: MAX_VERIFICATION_FIX_CYCLES } },
  )
  if (ctx.state.guardEvents.length > 0) lines.push({ key: 'diagnosticGuards', params: { guards: summarizeGuardEvents(ctx.state.guardEvents) } })
  if (runtime) {
    lines.push({
      key: 'diagnosticRuntime',
      params: {
        model: runtime.model,
        digest: runtime.digest || unavailable,
        numCtx: runtime.options.num_ctx,
        numPredict: runtime.options.num_predict,
      },
    })
  }
  if (latest) {
    lines.push({
      key: 'diagnosticLastGeneration',
      params: {
        step: latest.step,
        durationMs: latest.wallDurationMs,
        promptTokens: latest.promptTokens ?? notAvailable,
        completionTokens: latest.completionTokens ?? notAvailable,
      },
    })
  }
  return lines
}

function evidenceLevelFromCommand(command: string | undefined): 'structural' | 'behavioral' | undefined {
  if (!command) return undefined
  return /(^|[\s:&|])(test(?::\S+)?|pytest|vitest|jest|mocha)([\s:&|]|$)/i.test(command) ? 'behavioral' : 'structural'
}

function priorEvidenceLevel(ctx: ApplicationClosureContext): 'structural' | 'behavioral' | undefined {
  if (!ctx.flags.hasVerifiedBuild) return undefined
  const successful = ctx.episodicCompactor.getEpisodes().filter((episode) => episode.status === 'SUCCESS')
  if (successful.some((episode) => episode.tool === 'run_tests')) return 'behavioral'
  if (successful.some((episode) => episode.tool === 'run_command' && evidenceLevelFromCommand(episode.target) === 'behavioral')) {
    return 'behavioral'
  }
  return 'structural'
}

function evidenceLevelOf(run: VerificationRunResult): 'structural' | 'behavioral' | undefined {
  return run.evidenceLevel ?? evidenceLevelFromCommand(run.command)
}

function terminationReasonFor(trigger: ApplicationClosureTrigger, status: AgentCompletionStatus): AgentSessionTerminationReason {
  if (status === 'cancelled') return 'cancelled'
  if (trigger === 'finish') return 'finish'
  if (trigger === 'step_budget') return 'step_budget'
  if (trigger === 'transport_error') return 'transport_error'
  if (trigger === 'protocol_error') return 'protocol_error'
  if (trigger === 'guard_stop') return 'circuit_breaker'
  return 'model_silence'
}

const OUTCOME_KEYS: Record<AgentCompletionStatus, AgentMainTextKey> = {
  verified: 'closureOutcomeVerified',
  unverifiable: 'closureOutcomeUnverifiable',
  blocked: 'closureOutcomeBlocked',
  cancelled: 'closureOutcomeCancelled',
}

/** The closure summary as localizable lines; the Italian rendering is the summary text. */
function closureSummaryLines(
  status: AgentCompletionStatus,
  request: ApplicationClosureRequest,
  tracker: SessionDebtTracker,
  evidence: AgentLocalizedText,
): AgentLocalizedLine[] {
  const data = tracker.getData()
  const blank = { text: '' }
  const items = (values: readonly string[]) => values.slice(0, 8).map((item) => ({ text: `- ${item}` }))
  const lines: AgentLocalizedLine[] = [
    { key: OUTCOME_KEYS[status] },
    { key: 'closureReason', params: { reason: request.reason } },
    { key: 'closureEvidence', params: { evidence } },
  ]
  if (request.modelSummary?.trim()) {
    lines.push(blank, { key: 'closureModelSummary', params: { summary: request.modelSummary.trim() } })
  }
  if (data.completedTasks.length > 0) {
    lines.push(blank, { key: 'closureCompleted', params: { count: data.completedTasks.length } }, ...items(data.completedTasks))
  }
  const outstanding = [...data.unresolvedIssues, ...data.nextSteps]
  if (outstanding.length > 0) {
    lines.push(blank, { key: 'closureOutstanding', params: { count: outstanding.length } }, ...items(outstanding))
  }
  if (data.modifiedFiles.length > 0) {
    lines.push(blank, { key: 'closureModifiedFiles', params: { count: data.modifiedFiles.length } }, ...items(data.modifiedFiles))
  }
  if (data.completedTasks.length === 0 && data.modifiedFiles.length === 0) {
    lines.push(blank, { key: 'closureNoChanges' })
  }
  return lines
}

async function offerPublishedWorkspaceCommit(
  transaction: DisposableAgentWorkspace,
  changedPaths: readonly string[],
  requestApproval: NonNullable<ApplicationClosureContext['requestApproval']>,
  emitLog: EmitLog,
): Promise<void> {
  if (!gitCliRepository.getStatusAndDiff(transaction.sourcePath).isGitRepo) return
  try {
    const preview = gitCliRepository.previewCommit(transaction.sourcePath, changedPaths)
    const message = 'Agent Coding: publish reviewed changes'
    const approval = await requestApproval({
      type: 'git_commit',
      target: message,
      contentOrCmd: message,
      parameters: { commitPaths: preview.paths, commitDiff: preview.diffText, commitDiffHash: preview.diffHash },
    })
    if (!approval.approved) {
      emitLog('info', 'Commit delle modifiche pubblicate rifiutato; i file restano nel workspace.')
      return
    }
    gitCliRepository.commit(transaction.sourcePath, message, preview.paths, preview.diffHash)
    emitLog('info', `Commit creato per ${preview.paths.length} path pubblicati.`, undefined, { category: 'file_mutation' })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    emitLog('info', `Commit delle modifiche pubblicate non creato: ${message}`, undefined, { category: 'system_alert' })
  }
}

/** Single application-owned terminal gate for agent runs. */
export async function closeAgentRunFromEvidence(ctx: ApplicationClosureContext, request: ApplicationClosureRequest): Promise<ApplicationClosureOutcome> {
  // Cancellation owns its own rollback and checkpoint. Most importantly, no new verification
  // command may start once the session has been cancelled or replaced.
  if (!ctx.isSessionActive()) {
    return {
      outcome: 'closed',
      result: { success: false, summary: "Task interrotto dall'utente.", completionStatus: 'cancelled' },
    }
  }

  if (request.guard) recordGuardEvent(ctx.state.guardEvents, request.guard, 'stop', ctx.stepCount)

  let run: VerificationRunResult | undefined
  let evidenceLevel = priorEvidenceLevel(ctx)
  const shouldRunVerification = ctx.settings.verifyBeforeFinish !== false && ctx.flags.hasFileMutations && evidenceLevel !== 'behavioral'

  if (shouldRunVerification) {
    ctx.emitLog('info', '🔎 Verifica finale governata dall’applicazione...')
    run = await runProjectVerification(ctx.workspacePath, (chunk) => ctx.emitLog('terminal', chunk), ctx.signal)
    const verificationEvidence = toVerificationEvidence(run)
    ctx.recordVerificationEvidence?.(verificationEvidence)
    ctx.lastVerification = verificationEvidence
    if (!ctx.isSessionActive()) {
      return {
        outcome: 'closed',
        result: { success: false, summary: "Task interrotto dall'utente.", completionStatus: 'cancelled' },
      }
    }

    if (run.passed) {
      ctx.flags.hasVerifiedBuild = true
      evidenceLevel = evidenceLevelOf(run)
      promoteMilestonesProvenBy(ctx, run.command || 'verification command')
    } else if (request.allowCorrection) {
      const decision = decideVerificationGate({
        hasVerificationCommand: run.hasVerificationCommand,
        passed: run.passed,
        failureDetail: run.failureDetail,
        cyclesSpent: ctx.state.verificationFixCycles,
      })
      if (decision.action === 'block_and_retry') {
        ctx.state.verificationFixCycles = decision.cyclesSpent
        recordGuardEvent(ctx.state.guardEvents, 'verification_fix_cycles', 'advise', ctx.stepCount)
        ctx.episodicCompactor.recordStep(
          { step: ctx.stepCount, tool: 'application_verification', status: 'BLOCKED', summary: `Verification failed (round ${decision.cyclesSpent})` },
          decision.directive,
        )
        ctx.emitLog('info', `🔒 Verifica fallita (giro ${decision.cyclesSpent}): correzione richiesta.`, decision.directive, {
          category: 'system_alert',
        })
        await ctx.persistCurrentState()
        return { outcome: 'continue' }
      }
    }
  }

  const operational = ctx.goalPlanner.getMilestones().filter((milestone) => !isCompletionMilestoneTitle(milestone))
  const outstanding = operational.filter((milestone) => milestone.status === 'pending' || milestone.status === 'in_progress')
  const abandoned = operational.filter((milestone) => milestone.status === 'failed')

  let status: AgentCompletionStatus
  let evidence: AgentLocalizedText
  if (run?.hasVerificationCommand && run.passed === false) {
    status = 'blocked'
    const detail = run.failureDetail ? ` ${run.failureDetail}` : ''
    evidence = run.command
      ? { key: 'evidenceVerificationFailed', params: { command: run.command, detail } }
      : { key: 'evidenceProjectCheckFailed', params: { detail } }
  } else if (outstanding.length > 0 || abandoned.length > 0) {
    status = 'blocked'
    evidence = { key: 'evidenceOpenMilestones', params: { outstanding: outstanding.length, abandoned: abandoned.length } }
  } else if (evidenceLevel === 'behavioral') {
    status = 'verified'
    evidence = run?.command ? { key: 'evidenceBehavioralPassedCommand', params: { command: run.command } } : { key: 'evidenceBehavioralPassed' }
  } else if (evidenceLevel === 'structural') {
    status = 'unverifiable'
    evidence = run?.command ? { key: 'evidenceStructuralPassedCommand', params: { command: run.command } } : { key: 'evidenceStructuralPassed' }
  } else if (ctx.settings.verifyBeforeFinish === false) {
    status = 'unverifiable'
    evidence = { key: 'evidenceVerificationDisabled' }
  } else {
    status = 'unverifiable'
    evidence = { key: 'evidenceNoBehavioralCheck' }
  }

  // A safeguard ended the run before the model did: whatever the evidence, the work was cut off,
  // so it is never reported (or published) like an honest finish.
  if (request.guard && status !== 'blocked') {
    status = 'blocked'
    evidence = { key: 'evidenceGuardStop', params: { guard: request.guard, evidence } }
  }

  // Legacy plans may still contain a synthetic “invoke finish” milestone. It is control flow,
  // not user work: close it here so it cannot survive as artificial debt in the next session.
  for (const milestone of ctx.goalPlanner.getMilestones()) {
    if (isCompletionMilestoneTitle(milestone) && milestone.status !== 'verified') {
      ctx.goalPlanner.updateMilestone(milestone.id, 'verified', `Closed by application (${status}).`)
    }
  }

  const transaction = ctx.workspaceTransaction
  if (transaction && status !== 'blocked' && ctx.requestApproval) {
    const preview = transaction.preview()
    if (preview.changedPaths.length > 0) {
      const approval = await ctx.requestApproval({
        type: 'publish_workspace',
        target: transaction.sourcePath,
        contentOrCmd: `${preview.changedPaths.length} path(s): ${preview.changedPaths.slice(0, 20).join(', ')}`,
        parameters: { ...preview, sourcePath: transaction.sourcePath },
      })
      if (!approval.approved) {
        status = 'blocked'
        evidence = { key: 'evidencePublishRejected' }
      } else {
        const publication = transaction.publish()
        if (!publication.success) {
          status = 'blocked'
          evidence = publication.error ? { key: 'evidencePublishBlocked', params: { error: publication.error } } : { key: 'evidencePublishBlockedUnknown' }
        } else {
          ctx.emitLog('info', `Workspace pubblicato: ${publication.changedPaths.length} path(s).`, undefined, { category: 'file_mutation' })
          await offerPublishedWorkspaceCommit(transaction, publication.changedPaths, ctx.requestApproval, ctx.emitLog)
        }
      }
    }
  }

  const tracker = ctx.buildSessionTracker()
  const summaryLines = closureSummaryLines(status, request, tracker, evidence)
  const summary = renderAgentLines(summaryLines)
  if (!ctx.lastVerification && status === 'unverifiable') {
    const unavailable: AgentVerificationEvidence = {
      status: 'unavailable',
      checkedAt: new Date().toISOString(),
      detail: redactSecrets(formatAgentTextIt(evidence)),
    }
    ctx.lastVerification = unavailable
    ctx.recordVerificationEvidence?.(unavailable)
  }
  const diagnostics = diagnosticLines(ctx, request, status, ctx.lastVerification)
  const completionEvidence: AgentCompletionEvidence = {
    changedFiles: [...tracker.getData().modifiedFiles],
    verification: ctx.lastVerification,
    cancellationStatus: 'not_cancelled',
    nonRollbackEffects: [...(ctx.nonRollbackEffects || [])],
    ...(ctx.state.guardEvents.length > 0 ? { guardEvents: [...ctx.state.guardEvents] } : {}),
  }
  ctx.setExecutionPhase('outcome')
  agentToolExecutorService.commitJournal()
  const success = status === 'verified'
  const closureMessage: AgentLocalizedText = { key: 'closureMessage', params: { status } }
  ctx.emitLog('info', formatAgentTextIt(closureMessage), summary, {
    category: status === 'verified' ? 'final_report' : 'system_alert',
    localized: { message: closureMessage, detail: summaryLines },
  })
  const diagnosticMessage: AgentLocalizedText = { key: 'diagnosticMessage', params: { status } }
  ctx.emitLog('info', formatAgentTextIt(diagnosticMessage), renderAgentLines(diagnostics), {
    category: 'generic_info',
    modelName: ctx.runtimeProfile?.model,
    localized: { message: diagnosticMessage, detail: diagnostics },
  })
  ctx.emitDone(success, summary, status, completionEvidence)
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, success, summary)
  }
  await ctx.persistCurrentState(terminationReasonFor(request.trigger, status), status)
  if (ctx.workspacePath) {
    await agentSessionStateRepository.saveSessionTrackerMarkdown(ctx.workspacePath, ctx.buildSessionTracker(summary))
  }
  try {
    transaction?.dispose()
  } catch {
    // The source workspace has either been published or left untouched.
  }
  ctx.finalizeSession()
  return { outcome: 'closed', result: { success, summary, completionStatus: status, evidence: completionEvidence } }
}
