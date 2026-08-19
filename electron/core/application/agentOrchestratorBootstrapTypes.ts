import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { TransactionalExecutionGuard } from '../domain/agent/transactionalExecutionGuard'
import type { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { ResponseInterpreterState } from './agentOrchestratorResponseInterpreterTypes'
import type { ToolResultMutableFlags } from './agentOrchestratorToolResultTypes'
import type { AgentSession, ApprovalResponse } from './agentOrchestratorAppService'

export type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => void

export interface BootstrapParams {
  payload: AgentTaskPayload
  session: AgentSession
  sessionId: string
  isSessionActive: () => boolean
  /** Removes this run's session from the module-level registry (the Map lives in agentOrchestratorAppService.ts). */
  deregisterSession: () => void
}

/**
 * Everything runAgentOrchestratorLoop's turn loop needs after one-shot session setup:
 * resolved config/context strings, the loop-scoped state objects the turn-dispatch /
 * response-interpreter / tool-result-processor modules read and mutate in place, and the
 * closures (emitLog, persistCurrentState, requestApproval, finalizeSession, ...) that share that state by reference.
 */
export interface AgentSessionBootstrap {
  userTask: string
  initialUserTask: string
  agentMode: AgentExecutionMode
  workspacePath: string | null
  isStandaloneMode: boolean
  settings: AppSettings
  attachedContext: string
  pinnedFilesContextStr: string
  projectContextMapStr: string
  availableModels: string[]
  modelCapabilities: Record<string, string[]>
  skillMatchContext: SkillMatchContext
  skillMatchingOptions: SkillMatchingOptions
  episodicCompactor: EpisodicMemoryCompactor
  goalPlanner: GoalDecompositionPlanner
  fsmMode: AgentRuntimeModeFsm
  executionGuard: TransactionalExecutionGuard
  circuitBreaker: StagnationCircuitBreaker
  loopDetector: AgentActionLoopDetector
  /** DoD violation reasons already surfaced to the model -- each intercepts `finish` at most once. */
  surfacedDodReasons: Set<string>
  mutableFlags: ToolResultMutableFlags
  responseInterpreterState: ResponseInterpreterState
  /** Frozen per-session Ollama context window, boxed so agentOrchestratorTurnDispatch.ts can grow it in place. */
  sessionNumCtxBox: { value: number | null }
  /** Per-file line deltas applied during this session, for the UI's change metrics. */
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
  /** Boxed so both the timeout watchdog closure and the turn loop see the current step. */
  stepCountBox: { value: number }
  MAX_STEPS: number
  maxStepsLabel: string
  isUnlimitedSteps: boolean
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string) => void
  emitStepUpdate: (statusText?: string) => void
  persistCurrentState: () => Promise<void>
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  requestApproval: (approvalPayload: Record<string, unknown>) => Promise<ApprovalResponse>
  finalizeSession: () => void
  clearSessionTimeout: () => void
}
