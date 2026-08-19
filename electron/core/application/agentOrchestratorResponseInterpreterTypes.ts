import type { AgentToolCall, AgentTaskResult } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { TransactionalExecutionGuard } from '../domain/agent/transactionalExecutionGuard'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import type { ToolResultMutableFlags } from './agentOrchestratorToolResultProcessor'

export type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => void

/**
 * Loop-scoped counters the response interpreter and its helpers read and advance across turns.
 * stagnationStreak is the single shared "how stuck is the model right now" counter: both the
 * write/edit loop detector and the ask auto-healing gate increment it, so a model that escapes
 * a blocked write loop by switching to "ask" doesn't get a fresh grace period -- it inherits
 * however stuck it already was.
 */
export interface ResponseInterpreterState {
  noToolStreak: number
  stagnationStreak: number
}

export interface ResponseInterpreterContext {
  streamedOutput: string
  agentMode: AgentExecutionMode
  stepCount: number
  maxSteps: number
  isUnlimitedSteps: boolean
  workspacePath: string | null
  settings: AppSettings
  sessionId: string
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
  flags: ToolResultMutableFlags
  surfacedDodReasons: Set<string>
  state: ResponseInterpreterState
  episodicCompactor: EpisodicMemoryCompactor
  goalPlanner: GoalDecompositionPlanner
  executionGuard: TransactionalExecutionGuard
  loopDetector: AgentActionLoopDetector
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string) => void
  persistCurrentState: () => Promise<void>
  finalizeSession: () => void
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
}

export type ResponseInterpretationOutcome =
  | { outcome: 'continue' }
  | { outcome: 'return'; result: AgentTaskResult }
  | { outcome: 'proceed'; parsedTool: AgentToolCall }
