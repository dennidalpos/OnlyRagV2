import type { AgentToolCall, AgentTaskResult } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { TransactionalExecutionGuard } from '../domain/agent/transactionalExecutionGuard'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import type { ToolResultMutableFlags } from './agentOrchestratorToolResultProcessor'

import type { AgentLogEntry } from '../domain/agent/agentTypes'

export type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

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
  /**
   * Consecutive loop blocks whose repeated action had actually SUCCEEDED before. Counted apart
   * from stagnationStreak precisely so redundant-but-working calls never abandon a milestone
   * as FAILED; bounded by REDUNDANT_SUCCESS_ADVISORY_ATTEMPTS. See loopEscapePolicy.ts.
   */
  redundantSuccessStreak: number
  /**
   * Rounds of "verification failed, fix it and try again" already spent on this session.
   * Bounded by MAX_VERIFICATION_FIX_CYCLES: a model that cannot fix the failure would otherwise
   * spend the whole step budget rediscovering it. See verificationGatePolicy.ts.
   */
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
  emitDone: (success: boolean, summary: string) => void
  persistCurrentState: () => Promise<void>
  finalizeSession: () => void
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
}

export type ResponseInterpretationOutcome =
  | { outcome: 'continue' }
  | { outcome: 'return'; result: AgentTaskResult }
  | { outcome: 'proceed'; parsedTool: AgentToolCall }
