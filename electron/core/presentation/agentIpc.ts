import { ipcMain, BrowserWindow } from 'electron'
import { taskQueueAppService } from '../application/taskQueueAppService'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'

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
    return agentSessionStateRepository.clearSessionState(sessionId, workspacePath)
  })

  ipcMain.handle('agent:clear-all-sessions', async (_, workspacePath?: string | null) => {
    const success = await agentSessionStateRepository.clearAllSessionStates(workspacePath)
    codingAgentLogger.clearAuditLog()
    return success
  })

  ipcMain.handle('agent:clear-audit-log', async () => {
    return codingAgentLogger.clearAuditLog()
  })
}
