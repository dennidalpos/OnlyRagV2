import type { AppSettings } from '../../../src/types'
import type { AgentSession, ApprovalResponse } from './agentOrchestratorAppService'

export type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => void

export interface SessionWatchdogParams {
  session: AgentSession
  sessionId: string
  settings: AppSettings
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string) => void
  persistCurrentState: () => Promise<void>
  stepCountBox: { value: number }
  isSessionActive: () => boolean
  /** Removes this run's session from the module-level registry (the Map lives in agentOrchestratorAppService.ts). */
  deregisterSession: () => void
}

export interface SessionWatchdog {
  clearSessionTimeout: () => void
  /** Single exit point for the loop: clears the session timeout and deregisters the session. */
  finalizeSession: () => void
  requestApproval: (approvalPayload: Record<string, unknown>) => Promise<ApprovalResponse>
}
