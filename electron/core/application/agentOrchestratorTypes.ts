import type { ChildProcess } from 'node:child_process'
import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import type { AgentCompletionStatus, AgentRunIdentity, AgentVerificationEvidence } from '../../../shared/types'
import type { OllamaGenerationTelemetry, OllamaSessionRuntimeProfile } from '../domain/agent/ollamaSessionRuntime'
import type { AgentLogEntry } from '../domain/agent/agentTypes'
import { type AgentLocalizedText, formatAgentTextIt } from '../../../shared/domain/agent/agentMainText'
import type { AgentChatMessage } from '../infrastructure/http/agentStreamTransport'

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
  /** Native Ollama assistant/tool turns. The current bounded task context is supplied separately. */
  chatMessages?: AgentChatMessage[]
  /** Workspace the run edits in place; checkpoints are saved inside it. */
  workspacePath?: string | null
  /** System message frozen at the first native turn, so consecutive requests share a cacheable prefix. */
  nativeSystemPrompt?: string
  /** Local prompt-token estimate of the last request, compared with Ollama's reported count. */
  lastPromptTokenEstimate?: number
  /** Reported/estimated prompt tokens (1 to 1.5), applied to later estimates. */
  promptTokenRatio?: number
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
}
