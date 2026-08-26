import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { AgentSession } from './agentOrchestratorTypes'
import { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import { agentSessionStateRepository, type AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'

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
  session: AgentSession
  isSessionActive: () => boolean
}

export interface SessionPersistence {
  /** Builds the single SESSION_TRACKER.md payload from live session state. */
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  persistCurrentState: (terminationReason?: AgentSessionTerminationReason) => Promise<void>
  emitStepUpdate: (statusText?: string) => void
}

/**
 * Builds the checkpoint/reporting closures the turn loop calls every step: the compact
 * `.agent_state_*.json` snapshot, the SESSION_TRACKER.md projection, and the renderer's
 * step-progress event. All three read the same live goalPlanner/episodicCompactor/stepCountBox
 * so they stay consistent without re-deriving state.
 */
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
    session,
    isSessionActive,
  } = params

  const buildSessionTracker = (summaryText?: string): SessionDebtTracker => {
    const milestones = goalPlanner.getMilestones()
    return new SessionDebtTracker({
      sessionId,
      // The evidence that closed each milestone is carried into the tracker, not just the
      // fact that it closed. "m-14: Run the application — VERIFIED" told a reader nothing
      // about whether the application had ever been run; the cause makes that auditable.
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

  const persistCurrentState = async (terminationReason?: AgentSessionTerminationReason) => {
    // Only the plan's completion flag is persisted: every other field of the compact
    // state is a projection of planMilestones, which is already stored below.
    const isPlanCompleted = goalPlanner.hasPlan()
      ? goalPlanner.getCompactState(userTask).isCompleted
      : false

    await agentSessionStateRepository.saveSessionState({
      sessionId,
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
      status: isPlanCompleted ? 'COMPLETED' : 'IN_PROGRESS',
      terminationReason,
    })

    if (workspacePath) {
      await agentSessionStateRepository.saveSessionTrackerMarkdown(workspacePath, buildSessionTracker())
    }
  }

  const emitStepUpdate = (statusText?: string) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:step-update', {
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
