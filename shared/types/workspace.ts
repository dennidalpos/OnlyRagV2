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

/** `kept`: the run stopped and its file changes stayed on disk, restorable from `checkpointId`. */
export type AgentCancellationStatus = 'not_cancelled' | 'rolled_back' | 'residual_effects' | 'kept'

/** Structured facts rendered by the final Agent Coding evidence card. */
/** Every orchestration safeguard that can nudge, re-plan or stop an agent run. */
export type AgentGuardId =
  | 'loop_exact_repeat'
  | 'loop_unchanged_failure'
  | 'loop_cycle'
  | 'loop_same_file_edits'
  | 'loop_same_target_reads'
  | 'redundant_success'
  | 'stagnation_abort'
  | 'no_mutation'
  | 'schema_budget'
  | 'execution_budget'
  | 'transport_budget'
  | 'model_silence'
  | 'ask_redirect'
  | 'fs_oscillation'
  | 'verification_fix_cycles'
  | 'step_budget'
  | 'tool_policy'

/** `advise` nudges the model, `force_advance` abandons the active milestone, `stop` ends the run. */
export type AgentGuardAction = 'advise' | 'force_advance' | 'stop'

export interface AgentGuardEvent {
  guard: AgentGuardId
  action: AgentGuardAction
  step: number
}

export interface AgentCompletionEvidence {
  changedFiles: string[]
  verification?: AgentVerificationEvidence
  cancellationStatus: AgentCancellationStatus
  rollbackRestoredFiles?: number
  nonRollbackEffects: string[]
  /** Guards that fired during the run, oldest first (bounded). */
  guardEvents?: AgentGuardEvent[]
  /** Checkpoint holding the files as they were before the run (agent:restore-checkpoint). */
  checkpointId?: string
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
