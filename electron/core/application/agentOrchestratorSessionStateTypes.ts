import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { TransactionalExecutionGuard } from '../domain/agent/transactionalExecutionGuard'
import type { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import type { ResponseInterpreterState } from './agentOrchestratorResponseInterpreterTypes'
import type { ToolResultMutableFlags } from './agentOrchestratorToolResultTypes'

export type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => void

export interface SessionStateParams {
  payload: AgentTaskPayload
  sessionId: string
  workspacePath: string | null
  agentMode: AgentExecutionMode
  userTask: string
  settings: AppSettings
  emitLog: EmitLog
}

/** Loop-scoped state machines, guards and counters, restored from any saved session state. */
export interface SessionState {
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
  isUnlimitedSteps: boolean
  MAX_STEPS: number
  maxStepsLabel: string
  /** Boxed so both the timeout watchdog closure and the turn loop see the current step. */
  stepCountBox: { value: number }
  initialUserTask: string
  /** Frozen per-session Ollama context window, boxed so agentOrchestratorTurnDispatch.ts can grow it in place. */
  sessionNumCtxBox: { value: number | null }
  /** Per-file line deltas applied during this session, for the UI's change metrics. */
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
}
