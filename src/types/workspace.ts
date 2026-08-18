export interface WorkspaceProject {
  path: string
  name: string
  addedAt: string
  lastOpenedAt?: string
}

export type AgentExecutionMode = 'plan' | 'ask' | 'agent'

/** Outcome of a single prompt run inside a coding session. */
export type ExecutedPromptOutcome = 'running' | 'success' | 'failed' | 'cancelled' | 'unknown'

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
}

export interface QueuedPromptRecord {
  id: string
  prompt: string
  /** ISO 8601 timestamp. */
  createdAt: string
}
