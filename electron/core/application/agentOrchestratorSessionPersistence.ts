import type { AgentCompletionStatus, AgentExecutionMode, AppSettings } from '../../../shared/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { AgentSession } from './agentOrchestratorTypes'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { agentSessionStateRepository, type AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AgentExecutionPhaseController } from '../domain/agent/agentExecutionPhase'
import type { ResponseInterpreterState } from './agentOrchestratorResponseInterpreterTypes'

export interface SessionPersistenceParams {
  sessionId: string
  workspacePath: string | null
  agentMode: AgentExecutionMode
  userTask: string
  initialUserTask: string
  MAX_STEPS: number
  maxStepsLabel: string
  settings: AppSettings
  stepCountBox: { value: number }
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
  goalPlanner: GoalDecompositionPlanner
  episodicCompactor: EpisodicMemoryCompactor
  phaseController: AgentExecutionPhaseController
  responseInterpreterState: ResponseInterpreterState
  session: AgentSession
  isSessionActive: () => boolean
}

export interface SessionPersistence {
  /** Builds the single SESSION_TRACKER.md payload from live session state. */
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  persistCurrentState: (terminationReason?: AgentSessionTerminationReason, completionStatus?: AgentCompletionStatus) => Promise<void>
  emitStepUpdate: (statusText?: string) => void
}

/** Builds the checkpoint/reporting closures the turn loop calls every step: the compact `.agent_state_*.json` snapshot, the SESSION_TRACKER.md projection, and the renderer's step-progress event. */
export function buildSessionPersistence(params: SessionPersistenceParams): SessionPersistence {
  const {
    sessionId,
    workspacePath,
    agentMode,
    userTask,
    initialUserTask,
    MAX_STEPS,
    maxStepsLabel,
    settings,
    stepCountBox,
    sessionChangedFiles,
    goalPlanner,
    episodicCompactor,
    phaseController,
    responseInterpreterState,
    session,
    isSessionActive,
  } = params

  const buildSessionTracker = (summaryText?: string): SessionDebtTracker => {
    const milestones = goalPlanner.getMilestones()
    return new SessionDebtTracker({
      sessionId,
      // The evidence that closed each milestone is carried into the tracker, not just the fact that it closed.
      completedTasks: milestones
        .filter((m) => m.status === 'verified')
        .map((m) => `${m.id}: ${m.title}${m.notes ? ` — ${m.notes}` : ''}`),
      unresolvedIssues: milestones
        .filter((m) => m.status === 'failed')
        .map((m) => `${m.id}: ${m.title}${m.notes ? ` (${m.notes})` : ''}`),
      nextSteps: milestones
        .filter((m) => m.status === 'pending' || m.status === 'in_progress')
        .map((m) => `${m.id}: ${m.title}`),
      modifiedFiles: Array.from(sessionChangedFiles.keys()),
      summaryText,
    })
  }

  const persistCurrentState = async (
    terminationReason?: AgentSessionTerminationReason,
    completionStatus?: AgentCompletionStatus
  ) => {
    // Only the plan's completion flag is persisted: every other field of the compact
    // state is a projection of planMilestones, which is already stored below.
    const isPlanCompleted = goalPlanner.hasPlan()
      ? goalPlanner.getCompactState(userTask).isCompleted
      : false

    await agentSessionStateRepository.saveSessionState({
      sessionId,
      runIdentity: session.identity,
      workspacePath,
      agentMode,
      stepCount: stepCountBox.value,
      maxSteps: MAX_STEPS === Infinity ? 999 : MAX_STEPS,
      episodes: episodicCompactor.getEpisodes(),
      recentFullLogs: episodicCompactor.getRecentFullLogs(),
      planMilestones: [...goalPlanner.getMilestones()],
      userTask,
      initialUserTask,
      updatedAt: new Date().toISOString(),
      status: completionStatus
        ? completionStatus === 'verified' ? 'COMPLETED' : 'FAILED'
        : isPlanCompleted ? 'COMPLETED' : 'IN_PROGRESS',
      terminationReason,
      completionStatus,
      executionPhase: phaseController.getPhase(),
      recoveryFailures: {
        schema: responseInterpreterState.progress.snapshot().schemaFailure,
        execution: responseInterpreterState.progress.snapshot().executionFailure,
        versionConflictReadPath: responseInterpreterState.pendingVersionConflictReadPath,
        verificationFixCycles: responseInterpreterState.verificationFixCycles,
      },
      versionedReadEvidence: responseInterpreterState.versionedReadEvidence,
      guardEvents: [...responseInterpreterState.guardEvents],
      ...(terminationReason ? { terminationGuard: [...responseInterpreterState.guardEvents].reverse().find((event) => event.action === 'stop')?.guard } : {}),
      ollamaRuntimeProfile: session.ollamaRuntimeProfile,
      ollamaGenerationTelemetry: session.ollamaGenerationTelemetry,
      lastVerification: session.lastVerification,
    })

    if (workspacePath) {
      await agentSessionStateRepository.saveSessionTrackerMarkdown(workspacePath, buildSessionTracker())
    }
  }

  const emitStepUpdate = (statusText?: string) => {
    if (isSessionActive() && session.rendererEvents?.isAvailable()) {
      session.rendererEvents.send('agent:step-update', {
        ...session.identity,
        step: stepCountBox.value,
        maxSteps: MAX_STEPS === Infinity ? 999 : MAX_STEPS,
        maxStepsLabel,
        statusText,
        milestones: goalPlanner.getMilestones(),
      })
    }
  }

  // Each milestone status change is recorded with its cause, so a plan that closes something
  // it should not have can be traced to the exact step and rule that closed it.
  if (settings.enableCodingAgentDebugLog) {
    goalPlanner.onMilestoneTransition((transition) => {
      codingAgentLogger.logMilestoneTransition(
        sessionId,
        stepCountBox.value,
        transition.id,
        transition.title,
        transition.from,
        transition.to,
        transition.cause
      )
    })
  }

  return { buildSessionTracker, persistCurrentState, emitStepUpdate }
}
