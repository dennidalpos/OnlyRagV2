import type { AgentCompletionStatus, AppSettings } from '../../../shared/types'
import { isCompletionMilestoneTitle, type GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { decideVerificationGate } from '../domain/agent/verificationGatePolicy'
import { agentSessionStateRepository, type AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { agentToolExecutorService } from './agentToolExecutorService'
import { promoteMilestonesProvenBy } from './agentOrchestratorCircuitBreakerAndVerification'
import { runProjectVerification, type VerificationRunResult } from './agentOrchestratorVerificationRunner'
import type { EmitLog, ResponseInterpreterState } from './agentOrchestratorResponseInterpreterTypes'
import type { ToolResultMutableFlags } from './agentOrchestratorToolResultTypes'
import type {
  ApplicationClosureOutcome,
  ApplicationClosureRequest,
  ApplicationClosureTrigger,
} from './agentOrchestratorApplicationClosureTypes'
import type { AgentExecutionPhase } from '../domain/agent/agentExecutionPhase'

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
  emitDone: (success: boolean, summary: string, completionStatus?: AgentCompletionStatus) => void
  persistCurrentState: (
    terminationReason?: AgentSessionTerminationReason,
    completionStatus?: AgentCompletionStatus
  ) => Promise<void>
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  finalizeSession: () => void
  setExecutionPhase: (phase: AgentExecutionPhase) => void
}

function evidenceLevelFromCommand(command: string | undefined): 'structural' | 'behavioral' | undefined {
  if (!command) return undefined
  return /(^|[\s:&|])(test(?::\S+)?|pytest|vitest|jest|mocha)([\s:&|]|$)/i.test(command)
    ? 'behavioral'
    : 'structural'
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

function terminationReasonFor(
  trigger: ApplicationClosureTrigger,
  status: AgentCompletionStatus
): AgentSessionTerminationReason {
  if (status === 'cancelled') return 'cancelled'
  if (trigger === 'finish') return 'finish'
  if (trigger === 'step_budget') return 'step_budget'
  if (trigger === 'transport_error') return 'transport_error'
  if (trigger === 'protocol_error') return 'protocol_error'
  if (trigger === 'guard_stop') return 'circuit_breaker'
  return 'model_silence'
}

function renderClosureSummary(
  status: AgentCompletionStatus,
  request: ApplicationClosureRequest,
  tracker: SessionDebtTracker,
  evidence: string
): string {
  const data = tracker.getData()
  const labels: Record<AgentCompletionStatus, string> = {
    verified: 'VERIFICATO',
    unverifiable: 'NON VERIFICABILE',
    blocked: 'BLOCCATO',
    cancelled: 'ANNULLATO',
  }
  const lines = [
    `Esito applicativo: ${labels[status]}.`,
    `Motivo di chiusura: ${request.reason}`,
    `Evidenza: ${evidence}`,
  ]
  if (request.modelSummary?.trim()) {
    lines.push('', `Ultima consegna del modello: ${request.modelSummary.trim()}`)
  }
  if (data.completedTasks.length > 0) {
    lines.push('', `Completato (${data.completedTasks.length}):`, ...data.completedTasks.slice(0, 8).map((item) => `- ${item}`))
  }
  const outstanding = [...data.unresolvedIssues, ...data.nextSteps]
  if (outstanding.length > 0) {
    lines.push('', `Residuo (${outstanding.length}):`, ...outstanding.slice(0, 8).map((item) => `- ${item}`))
  }
  if (data.modifiedFiles.length > 0) {
    lines.push('', `File modificati (${data.modifiedFiles.length}):`, ...data.modifiedFiles.slice(0, 8).map((item) => `- ${item}`))
  }
  if (data.completedTasks.length === 0 && data.modifiedFiles.length === 0) {
    lines.push('', 'Nessuna modifica è stata scritta sul workspace durante questa sessione.')
  }
  return lines.join('\n')
}

/**
 * Single application-owned terminal gate for agent runs. The model may suggest that work is
 * finished, go silent, exhaust its budget or lose transport; none of those events decides the
 * outcome. This function checks current evidence, preserves partial work, persists the exact
 * reason and emits one explicit terminal status.
 */
export async function closeAgentRunFromEvidence(
  ctx: ApplicationClosureContext,
  request: ApplicationClosureRequest
): Promise<ApplicationClosureOutcome> {
  // Cancellation owns its own rollback and checkpoint. Most importantly, no new verification
  // command may start once the session has been cancelled or replaced.
  if (!ctx.isSessionActive()) {
    return {
      outcome: 'closed',
      result: { success: false, summary: "Task interrotto dall'utente.", completionStatus: 'cancelled' },
    }
  }

  let run: VerificationRunResult | undefined
  let evidenceLevel = priorEvidenceLevel(ctx)
  const shouldRunVerification =
    ctx.settings.verifyBeforeFinish !== false &&
    ctx.flags.hasFileMutations &&
    evidenceLevel !== 'behavioral'

  if (shouldRunVerification) {
    ctx.emitLog('info', '🔎 Verifica finale governata dall’applicazione...')
    run = await runProjectVerification(ctx.workspacePath, (chunk) => ctx.emitLog('terminal', chunk))
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
        ctx.episodicCompactor.recordStep(
          { step: ctx.stepCount, tool: 'application_verification', status: 'BLOCKED', summary: `Verification failed (round ${decision.cyclesSpent})` },
          decision.directive
        )
        ctx.emitLog('info', `🔒 Verifica fallita (giro ${decision.cyclesSpent}): correzione richiesta.`, decision.directive, {
          category: 'system_alert',
        })
        return { outcome: 'continue' }
      }
    }
  }

  const operational = ctx.goalPlanner.getMilestones().filter((milestone) => !isCompletionMilestoneTitle(milestone.title))
  const outstanding = operational.filter((milestone) => milestone.status === 'pending' || milestone.status === 'in_progress')
  const abandoned = operational.filter((milestone) => milestone.status === 'failed')

  let status: AgentCompletionStatus
  let evidence: string
  if (run?.hasVerificationCommand && run.passed === false) {
    status = 'blocked'
    evidence = `La verifica "${run.command || 'comando di progetto'}" è fallita.${run.failureDetail ? ` ${run.failureDetail}` : ''}`
  } else if (outstanding.length > 0 || abandoned.length > 0) {
    status = 'blocked'
    evidence = `${outstanding.length} milestone operative aperte e ${abandoned.length} abbandonate.`
  } else if (evidenceLevel === 'behavioral') {
    status = 'verified'
    evidence = `Controllo comportamentale superato${run?.command ? `: "${run.command}"` : ''}.`
  } else if (evidenceLevel === 'structural') {
    status = 'unverifiable'
    evidence = `Controllo strutturale superato${run?.command ? `: "${run.command}"` : ''}; build, typecheck, lint e presenza dei file non provano il comportamento end-to-end.`
  } else if (ctx.settings.verifyBeforeFinish === false) {
    status = 'unverifiable'
    evidence = 'La verifica finale è disabilitata nelle impostazioni; nessuna prova comportamentale è stata raccolta.'
  } else {
    status = 'unverifiable'
    evidence = 'Il progetto non espone un controllo comportamentale eseguibile; il risultato non è stato dichiarato funzionante.'
  }

  // Legacy plans may still contain a synthetic “invoke finish” milestone. It is control flow,
  // not user work: close it here so it cannot survive as artificial debt in the next session.
  for (const milestone of ctx.goalPlanner.getMilestones()) {
    if (isCompletionMilestoneTitle(milestone.title) && milestone.status !== 'verified') {
      ctx.goalPlanner.updateMilestone(milestone.id, 'verified', `Closed by application (${status}).`)
    }
  }

  const tracker = ctx.buildSessionTracker()
  const summary = renderClosureSummary(status, request, tracker, evidence)
  ctx.setExecutionPhase('outcome')
  agentToolExecutorService.commitJournal()
  const success = status === 'verified'
  ctx.emitLog('info', `Chiusura applicativa: ${status}`, summary, {
    category: status === 'verified' ? 'final_report' : 'system_alert',
  })
  ctx.emitDone(success, summary, status)
  if (ctx.settings.enableCodingAgentDebugLog) {
    codingAgentLogger.logSessionEnd(ctx.sessionId, ctx.stepCount, success, summary)
  }
  await ctx.persistCurrentState(terminationReasonFor(request.trigger, status), status)
  if (ctx.workspacePath) {
    await agentSessionStateRepository.saveSessionTrackerMarkdown(ctx.workspacePath, ctx.buildSessionTracker(summary))
  }
  ctx.finalizeSession()
  return { outcome: 'closed', result: { success, summary, completionStatus: status } }
}
