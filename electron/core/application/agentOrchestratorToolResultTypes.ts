import type { BrowserWindow } from 'electron'
import type { AgentCompletionStatus, AppSettings } from '../../../shared/types'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import type { ToolExecutionResult } from './agentToolExecutorService'
import type { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import type { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { AgentTaskResult } from '../domain/agent/agentTypes'
import type { ApplicationClosureOutcome, ApplicationClosureRequest } from './agentOrchestratorApplicationClosureTypes'
import type { RecoveryFailureState } from '../domain/agent/recoveryBudget'

import type { AgentLogEntry } from '../domain/agent/agentTypes'

export type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

/** The subset of the loop's mutable counters this step can flip. Mutated in place by design
 *  (same pattern as the AgentSession object) -- see agentOrchestratorAppService.ts's mutableFlags. */
export interface ToolResultMutableFlags {
  hasFileMutations: boolean
  hasVerifiedBuild: boolean
}

export interface ToolResultProcessingContext {
  toolRes: ToolExecutionResult
  parsedTool: AgentToolCall
  /** Wall-clock ms captured immediately before the tool ran; used to attribute files a
   *  shell command touched (see commandTouchedFilesScanner.ts). */
  toolStartedAtMs: number
  stepCount: number
  sessionId: string
  settings: AppSettings
  workspacePath: string | null
  targetModel: string
  isUnlimitedSteps: boolean
  flags: ToolResultMutableFlags
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
  episodicCompactor: EpisodicMemoryCompactor
  goalPlanner: GoalDecompositionPlanner
  executionGuard: TransactionalExecutionGuard
  circuitBreaker: StagnationCircuitBreaker
  /** Same instance the response interpreter checks against: this step feeds the real
   *  execution outcome back into it. */
  loopDetector: AgentActionLoopDetector
  recoveryState: { executionRecoveryFailure?: RecoveryFailureState }
  isSessionActive: () => boolean
  targetWindow: BrowserWindow | null
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string, completionStatus?: AgentCompletionStatus) => void
  persistCurrentState: () => Promise<void>
  finalizeSession: () => void
  closeApplicationRun: (request: ApplicationClosureRequest) => Promise<ApplicationClosureOutcome>
}

export type ToolResultProcessingOutcome =
  | { outcome: 'continue' }
  | { outcome: 'return'; result: AgentTaskResult }
