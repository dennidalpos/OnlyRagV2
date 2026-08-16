import { ipcMain, BrowserWindow } from 'electron'
import { taskQueueAppService } from '../application/taskQueueAppService'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { sidecarSlmBridgeService } from '../application/sidecarSlmBridgeService'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { SlmOrchestrationRequest } from '../../../src/types'

export function registerAgentIpcHandlers(winGetter: () => BrowserWindow | null) {
  ipcMain.handle('agent:start-task', async (_, payload: AgentTaskPayload) => {
    return taskQueueAppService.scheduleAgentTask(payload, winGetter)
  })

  ipcMain.handle('agent:cancel-task', async (_, taskId?: string) => {
    return taskQueueAppService.cancelTask(taskId)
  })

  ipcMain.handle('agent:get-queue-status', async () => {
    return taskQueueAppService.getQueueStatus()
  })

  ipcMain.handle('agent:set-max-concurrency', async (_, limit: number) => {
    taskQueueAppService.setMaxConcurrency(limit)
    return { success: true, maxConcurrency: taskQueueAppService.getMaxConcurrency() }
  })

  ipcMain.handle('agent:parse-tool-call', async (_, rawText: string) => {
    return parseAgentToolCall(rawText)
  })

  ipcMain.handle('agent:delete-session', async (_, sessionId: string, workspacePath?: string | null) => {
    const success = await agentSessionStateRepository.clearSessionState(sessionId, workspacePath)
    codingAgentLogger.removeSessionFromAuditLog(sessionId)
    return success
  })

  ipcMain.handle('agent:clear-all-sessions', async (_, workspacePath?: string | null) => {
    const success = await agentSessionStateRepository.clearAllSessionStates(workspacePath)
    codingAgentLogger.clearAuditLog()
    return success
  })

  ipcMain.handle('agent:clear-audit-log', async () => {
    return codingAgentLogger.clearAuditLog()
  })

  /**
   * SLM Agent Studio: execute one orchestration turn via the Python sidecar.
   * Receives the full SlmOrchestrationRequest from the renderer and returns
   * the SlmOrchestrationResult (tool call or L3 degraded text response).
   */
  ipcMain.handle('agent:slm-orchestrate', async (_, request: SlmOrchestrationRequest) => {
    return sidecarSlmBridgeService.orchestrate(request)
  })

  /**
   * SLM Agent Studio: trigger log anomaly diagnostics analysis.
   * Returns SlmLogDiagnosticReport with all detected anomalies
   * (truncated JSON, VRAM thrashing, tool-calling loops).
   */
  ipcMain.handle('agent:logs-analyze', async (_, extraPaths?: string[]) => {
    return sidecarSlmBridgeService.analyzeLogs(extraPaths)
  })
}
