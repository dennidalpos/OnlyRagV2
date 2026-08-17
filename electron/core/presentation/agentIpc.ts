import { ipcMain, BrowserWindow } from 'electron'
import { taskQueueAppService } from '../application/taskQueueAppService'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { sidecarSlmBridgeService } from '../application/sidecarSlmBridgeService'
import { planGenerationAppService } from '../application/planGenerationAppService'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AppSettings } from '../../../src/types'

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
   * SLM Agent Studio: trigger log anomaly diagnostics analysis.
   * Returns SlmLogDiagnosticReport with all detected anomalies
   * (truncated JSON, VRAM thrashing, tool-calling loops).
   */
  ipcMain.handle('agent:logs-analyze', async (_, extraPaths?: string[]) => {
    return sidecarSlmBridgeService.analyzeLogs(extraPaths)
  })

  /**
   * Plan Approval flow: draft a plan for the given prompt, routed through the
   * hardware-profile Ollama runtime options and parsed via the canonical
   * GoalDecompositionPlanner parser (replaces the renderer's raw fetch()).
   */
  ipcMain.handle(
    'agent:plan-generate',
    async (_, prompt: string, model: string | undefined, settings: AppSettings, pendingResidueMilestones?: any[]) => {
      return planGenerationAppService.generatePlanText({ prompt, model, settings, pendingResidueMilestones })
    }
  )

  /**
   * Re-parses (e.g. user-edited) plan text into canonical milestones, using
   * the same parser as agent:plan-generate and the orchestrator loop itself.
   */
  ipcMain.handle('agent:plan-parse-text', async (_, planText: string) => {
    return planGenerationAppService.parsePlanText(planText)
  })

  /**
   * Exposes the backend's persisted plan milestone state (GoalDecompositionPlanner's
   * completion truth, written by agentOrchestratorAppService.persistCurrentState)
   * so the frontend can reflect verified/in-progress/failed status instead of
   * guessing progress from step counts.
   */
  ipcMain.handle('agent:get-plan-state', async (_, sessionId: string, workspacePath?: string | null) => {
    const state = await agentSessionStateRepository.loadSessionState(sessionId, workspacePath)
    if (!state) return null
    return { planMilestones: state.planMilestones, status: state.status, stepCount: state.stepCount }
  })

  /**
   * Seeds the approved plan's milestones into persisted session state before
   * task execution starts, so runAgentOrchestratorLoop's restore-from-savedState
   * path loads them into GoalDecompositionPlanner as its starting state.
   */
  ipcMain.handle(
    'agent:plan-seed',
    async (_, sessionId: string, workspacePath: string | null, planMilestones: any[], userTask?: string) => {
      return agentSessionStateRepository.seedPlanMilestones(sessionId, workspacePath, planMilestones, userTask)
    }
  )
}
