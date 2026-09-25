import type { ChildProcess } from 'node:child_process'
import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import type { ObservedToolCallingProtocol } from '../../../shared/domain/agent/ollamaToolCallingCapability'
import type { AgentCompletionStatus, AgentRunIdentity, AgentVerificationEvidence } from '../../../shared/types'
import type { OllamaGenerationTelemetry, OllamaSessionRuntimeProfile } from '../domain/agent/ollamaSessionRuntime'
import type { DisposableAgentWorkspace } from '../infrastructure/filesystem/disposableAgentWorkspace'
import type { AgentLogEntry } from '../domain/agent/agentTypes'
import { type AgentLocalizedText, formatAgentTextIt } from '../../../shared/domain/agent/agentMainText'

export type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string, meta?: Partial<AgentLogEntry>) => void

/** Emits an entry the renderer shows in the UI language; the Italian rendering stays its `message`/`detail`. A string detail is verbatim (command output, model text). */
export function emitLocalizedLog(
  emitLog: EmitLog,
  type: Parameters<EmitLog>[0],
  message: AgentLocalizedText,
  detail?: AgentLocalizedText | string,
  meta?: Partial<AgentLogEntry>,
): void {
  const localizedDetail = typeof detail === 'object' ? detail : undefined
  emitLog(type, formatAgentTextIt(message), localizedDetail ? formatAgentTextIt(localizedDetail) : (detail as string | undefined) || undefined, {
    ...meta,
    localized: { message, ...(localizedDetail ? { detail: [localizedDetail] } : {}) },
  })
}

export interface ApprovalResponse {
  approved: boolean
  /** Approved hunk indices for partial file-mutation approval. */
  approvedHunkIndices?: number[]
}

export interface AgentSession {
  id: string
  identity: Readonly<AgentRunIdentity>
  isCancelled: boolean
  abortController?: AbortController
  rendererEvents: RendererEventSink | null
  activeCancelHandle?: (() => void) | null
  activeChildProcess?: ChildProcess | null
  /** Global session watchdog. Cleared on every exit path so it can never outlive its own run. */
  timeoutHandle?: NodeJS.Timeout | null
  /** Ollama `context` continuation cache (AGT1): the token array + the exact stable/history baseline it corresponds to, so the next turn can detect whether a tail-append delta can be sent instead of the full prompt. */
  ollamaContextTokens?: number[]
  ollamaContextModel?: string
  ollamaContextStableSection?: string
  ollamaContextHistoryBlock?: string
  /** Protocol observed from the first capability-less Ollama turn, keyed by exact model tag. */
  toolCallingProtocolByModel?: Record<string, ObservedToolCallingProtocol>
  /** Set while the loop is paused inside an approval gate (see `requestApproval` in runAgentOrchestratorLoop), so an in-flight `agent:approval-response` and a cancellation/timeout racing against it both resolve the same pending Promise exactly once instead of leavi */
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
  /** Files observed as changed during this run, retained for cancellation evidence. */
  changedFiles?: string[]
  /** Effects that the workspace journal cannot guarantee to undo. */
  nonRollbackEffects?: string[]
  /** User-requested aggressive prompt compaction; the Renderer audit timeline is unaffected. */
  forceContextCompaction?: boolean
  /** Isolated workspace owned by this run; discarded after cancellation or completion. */
  workspaceTransaction?: DisposableAgentWorkspace
}
