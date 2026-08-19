import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import type { AgentSession } from './agentOrchestratorAppService'

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
  persistCurrentState: () => Promise<void>
  emitStepUpdate: (statusText?: string) => void
}
