export interface WorkspaceProject {
  path: string
  name: string
  addedAt: string
  lastOpenedAt?: string
}

export type AgentExecutionMode = 'ask' | 'guided' | 'auto'

/** Outcome of a single prompt run inside a coding session. */
export type ExecutedPromptOutcome = 'running' | 'success' | 'failed' | 'cancelled' | 'unknown'

/** Evidence-based terminal state emitted by the application-owned agent closure. */
export type AgentCompletionStatus = 'verified' | 'unverifiable' | 'blocked' | 'cancelled'

/** Last application-owned verification attempt persisted with a coding run. */
export interface AgentVerificationEvidence {
  status: 'verified' | 'failed' | 'unavailable'
  checkedAt: string
  command?: string
  evidenceLevel?: 'structural' | 'behavioral'
  detail?: string
}

export type AgentCancellationStatus = 'not_cancelled' | 'rolled_back' | 'residual_effects'

/** Structured facts rendered by the final Agent Coding evidence card. */
export interface AgentCompletionEvidence {
  changedFiles: string[]
  verification?: AgentVerificationEvidence
  cancellationStatus: AgentCancellationStatus
  rollbackRestoredFiles?: number
  nonRollbackEffects: string[]
}

/**
 * A single prompt executed by the agent inside a CodingSession, with the
 * metrics collected while it ran. Timestamps are always ISO 8601 strings.
 */
export interface ExecutedPrompt {
  id: string
  sessionId: string
  prompt: string
  /** ISO 8601 timestamp of when the run started. */
  startedAt: string
  /** ISO 8601 timestamp of when the run terminated (absent while running). */
  completedAt?: string
  agentMode: AgentExecutionMode
  outcome: ExecutedPromptOutcome
  totalSteps: number
  filesTouched: number
  additions: number
  deletions: number
  summary?: string
  completionStatus?: AgentCompletionStatus
  evidence?: AgentCompletionEvidence
}

export interface QueuedPromptRecord {
  id: string
  prompt: string
  /** ISO 8601 timestamp. */
  createdAt: string
}
