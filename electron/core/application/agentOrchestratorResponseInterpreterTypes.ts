import type { AgentToolCall, AgentTaskResult } from '../domain/agent/agentTypes'
import type { AgentCompletionStatus, AgentExecutionMode, AppSettings } from '../../../shared/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import type { ToolResultMutableFlags } from './agentOrchestratorToolResultProcessor'

import type { AgentLogEntry } from '../domain/agent/agentTypes'
import type { AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'
import type { ApplicationClosureOutcome, ApplicationClosureRequest } from './agentOrchestratorApplicationClosureTypes'
import type { RecoveryFailureState } from '../domain/agent/recoveryBudget'

export type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

/** Loop-scoped counters the response interpreter and its helpers read and advance across turns. */
export interface ResponseInterpreterState {
  noToolStreak: number
  /** Consecutive tool calls refused by parameter validation, reset by any call that parses. */
  schemaRejectionStreak: number
  /** Persistable bounded budget for equivalent invalid tool calls. */
  schemaRecoveryFailure?: RecoveryFailureState
  /** Persistable bounded budget for failed tool executions. */
  executionRecoveryFailure?: RecoveryFailureState
  /** Existing file that must be read before another edit is accepted. */
  pendingVersionConflictReadPath?: string
  /** Latest read hash, consumed by the next edit of that file. */
  versionedReadEvidence?: { filePath: string; contentHash: string }
  stagnationStreak: number
  /** Consecutive loop blocks whose repeated action had actually SUCCEEDED before. */
  redundantSuccessStreak: number
  /** Rounds of "verification failed, fix it and try again" already spent on this session. */
  verificationFixCycles: number
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
  emitDone: (success: boolean, summary: string, completionStatus?: AgentCompletionStatus) => void
  persistCurrentState: (terminationReason?: AgentSessionTerminationReason, completionStatus?: AgentCompletionStatus) => Promise<void>
  finalizeSession: () => void
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  closeApplicationRun: (request: ApplicationClosureRequest) => Promise<ApplicationClosureOutcome>
}

export type ResponseInterpretationOutcome =
  | { outcome: 'continue' }
  | { outcome: 'return'; result: AgentTaskResult }
  | { outcome: 'proceed'; parsedTool: AgentToolCall }
