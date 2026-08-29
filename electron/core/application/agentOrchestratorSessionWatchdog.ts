import type { AppSettings } from '../../../shared/types'
import type { AgentSession, ApprovalResponse } from './agentOrchestratorTypes'
import { logger } from '../../diagnostics'
import { agentToolExecutorService } from './agentToolExecutorService'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'

import type { AgentLogEntry } from '../domain/agent/agentTypes'

export type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

export interface SessionWatchdogParams {
  session: AgentSession
  sessionId: string
  settings: AppSettings
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string) => void
  persistCurrentState: (terminationReason?: AgentSessionTerminationReason) => Promise<void>
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

/**
 * Arms the global session timeout (guarantees SESSION END is always written to the audit
 * log even if the loop hangs) and builds the finalize/approval closures tied to it. Default
 * timeout: 45 minutes, configurable via settings.agentSessionTimeoutMinutes.
 */
export function armSessionWatchdog(params: SessionWatchdogParams): SessionWatchdog {
  const { session, sessionId, settings, emitLog, emitDone, persistCurrentState, stepCountBox, isSessionActive, deregisterSession } = params

  const clearSessionTimeout = () => {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle)
      session.timeoutHandle = null
    }
  }

  const finalizeSession = () => {
    clearSessionTimeout()
    deregisterSession()
  }

  const SESSION_TIMEOUT_MS = Math.max(5, (settings as any).agentSessionTimeoutMinutes || 45) * 60 * 1000
  session.timeoutHandle = setTimeout(async () => {
    // isSessionActive() already covers both guards a bare identity check would add: it is
    // false the instant this session is no longer the one registered under sessionId (e.g. a
    // reused sessionId now owned by a later run) or once it has already been cancelled/ended.
    if (!isSessionActive()) return
    const timeoutSummary = `Sessione terminata automaticamente: superato il limite di ${Math.round(SESSION_TIMEOUT_MS / 60000)} minuti.`
    logger.log('WARN', 'AgentOrchestratorApp', `[SESSION TIMEOUT] ${timeoutSummary} SessionId: ${sessionId}`)
    emitLog('info', `⏱️ Session Timeout: ${timeoutSummary}`)
    session.isCancelled = true
    if (session.pendingApprovalResolve) {
      session.pendingApprovalResolve({ approved: false })
      session.pendingApprovalResolve = undefined
    }
    codingAgentLogger.logSessionEnd(sessionId, stepCountBox.value, false, timeoutSummary)
    emitDone(false, timeoutSummary)
    agentToolExecutorService.rollbackJournal()
    await persistCurrentState('timeout')
    finalizeSession()
  }, SESSION_TIMEOUT_MS)

  /**
   * Sends `agent:approval-request` and pauses the calling step in place until the renderer
   * answers via the `agent:approval-response` IPC channel (see `respondToApproval` in
   * agentOrchestratorAppService.ts), or until cancellation/timeout resolves it to `false`.
   * The session stays registered the whole time, so this is a real pause of the same loop
   * iteration -- not the "end the task, then have the renderer re-execute the action on its
   * own" round trip this replaces.
   */
  const requestApproval = (approvalPayload: Record<string, unknown>): Promise<ApprovalResponse> => {
    return new Promise<ApprovalResponse>((resolve) => {
      if (!session.targetWindow || session.targetWindow.isDestroyed()) {
        resolve({ approved: false })
        return
      }
      session.pendingApprovalResolve = resolve
      session.targetWindow.webContents.send('agent:approval-request', { sessionId: session.id, ...approvalPayload })
    })
  }

  return { clearSessionTimeout, finalizeSession, requestApproval }
}
