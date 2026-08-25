import type { BrowserWindow } from 'electron'
import type { ObservedToolCallingProtocol } from '../domain/agent/ollamaToolCallingCapability'

export interface ApprovalResponse {
  approved: boolean
  /** Indices (into groupDiffIntoHunks' result) of the hunks the user approved, for a partial (not all-or-nothing) file-mutation approval. */
  approvedHunkIndices?: number[]
}

export interface AgentSession {
  id: string
  isCancelled: boolean
  targetWindow: BrowserWindow | null
  activeCancelHandle?: (() => void) | null
  activeChildProcess?: any | null
  /** Global session watchdog. Cleared on every exit path so it can never outlive its own run. */
  timeoutHandle?: NodeJS.Timeout | null
  /**
   * Ollama `context` continuation cache (AGT1): the token array + the exact
   * stable/history baseline it corresponds to, so the next turn can detect
   * whether a tail-append delta can be sent instead of the full prompt. See
   * ollamaContextCacheManager.ts. Scoped to this single agent run — cleared
   * implicitly whenever a new AgentSession is created.
   */
  ollamaContextTokens?: number[]
  ollamaContextModel?: string
  ollamaContextStableSection?: string
  ollamaContextHistoryBlock?: string
  /** Protocol observed from the first capability-less Ollama turn, keyed by exact model tag. */
  toolCallingProtocolByModel?: Record<string, ObservedToolCallingProtocol>
  /**
   * Set while the loop is paused inside an approval gate (see `requestApproval` in
   * runAgentOrchestratorLoop), so an in-flight `agent:approval-response` and a
   * cancellation/timeout racing against it both resolve the same pending Promise exactly
   * once instead of leaving the paused `while` loop blocked forever.
   */
  pendingApprovalResolve?: (response: ApprovalResponse) => void
}
