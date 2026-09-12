import type { BrowserWindow } from 'electron'
import type { ObservedToolCallingProtocol } from '../../../shared/domain/agent/ollamaToolCallingCapability'
import type { AgentCompletionStatus, AgentRunIdentity, AgentVerificationEvidence } from '../../../shared/types'
import type { OllamaGenerationTelemetry, OllamaSessionRuntimeProfile } from '../domain/agent/ollamaSessionRuntime'
import type { DisposableAgentWorkspace } from '../infrastructure/filesystem/disposableAgentWorkspace'

export interface ApprovalResponse {
  approved: boolean
  /** Approved hunk indices for partial file-mutation approval. */
  approvedHunkIndices?: number[]
}

export interface AgentSession {
  id: string
  identity: Readonly<AgentRunIdentity>
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
  /** Registered after bootstrap so user cancellation can persist its terminal cause. */
  persistCancellation?: () => Promise<void>
  /** Terminal state set by cancellation/timeout before an in-flight operation unwinds. */
  completionStatus?: AgentCompletionStatus
  terminalSummary?: string
  /** Model, endpoint and options frozen for this resumable run. */
  ollamaRuntimeProfile?: OllamaSessionRuntimeProfile
  /** Bounded per-turn inference measurements persisted with the session. */
  ollamaGenerationTelemetry?: OllamaGenerationTelemetry[]
  /** Last project check, including an explicit unavailable state. */
  lastVerification?: AgentVerificationEvidence
  /** Isolated workspace owned by this run; discarded after cancellation or completion. */
  workspaceTransaction?: DisposableAgentWorkspace
}
