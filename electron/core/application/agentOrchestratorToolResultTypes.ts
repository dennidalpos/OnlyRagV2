import type { BrowserWindow } from 'electron'
import type { AppSettings } from '../../../src/types'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import type { ToolExecutionResult } from './agentToolExecutorService'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { TransactionalExecutionGuard } from '../domain/agent/transactionalExecutionGuard'
import type { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'

export type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => void

/** The subset of the loop's mutable counters this step can flip. Mutated in place by design
 *  (same pattern as the AgentSession object) -- see agentOrchestratorAppService.ts's mutableFlags. */
export interface ToolResultMutableFlags {
  hasFileMutations: boolean
  hasVerifiedBuild: boolean
  currentOverriddenModel: string | null
}

export interface ToolResultProcessingContext {
  toolRes: ToolExecutionResult
  parsedTool: AgentToolCall
  stepCount: number
  sessionId: string
  settings: AppSettings
  workspacePath: string | null
  targetModel: string
  intermediateModel: string
  fallbackModel: string
  heavyEscalationModel: string | undefined
  isUnlimitedSteps: boolean
  flags: ToolResultMutableFlags
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
  episodicCompactor: EpisodicMemoryCompactor
  goalPlanner: GoalDecompositionPlanner
  executionGuard: TransactionalExecutionGuard
  circuitBreaker: StagnationCircuitBreaker
  isSessionActive: () => boolean
  targetWindow: BrowserWindow | null
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string) => void
  persistCurrentState: () => Promise<void>
  finalizeSession: () => void
}

export type ToolResultProcessingOutcome =
  | { outcome: 'continue' }
  | { outcome: 'return'; result: { success: boolean; summary: string } }
