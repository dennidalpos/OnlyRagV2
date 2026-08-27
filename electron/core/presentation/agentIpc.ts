import { ipcMain, BrowserWindow } from 'electron'
import { taskQueueAppService } from '../application/taskQueueAppService'
import { respondToApproval } from '../application/agentOrchestratorAppService'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { agentSessionStateAppService } from '../application/agentSessionStateAppService'
import { sidecarSlmBridgeService } from '../application/sidecarSlmBridgeService'
import { planGenerationAppService } from '../application/planGenerationAppService'
import { agentInterviewAppService } from '../application/agentInterviewAppService'
import { aiDebugBundleService } from '../application/aiDebugBundleService'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AppSettings } from '../../../src/types'

export function registerAgentIpcHandlers(winGetter: () => BrowserWindow | null) {
  ipcMain.handle('agent:start-task', async (_, payload: AgentTaskPayload) => {
    return taskQueueAppService.scheduleAgentTask(payload, winGetter)
  })

  ipcMain.handle('agent:cancel-task', async (_, taskId?: string) => {
    return taskQueueAppService.cancelTask(taskId)
  })

  ipcMain.handle('agent:approval-response', async (_, sessionId: string, approved: boolean, approvedHunkIndices?: number[]) => {
    return respondToApproval(sessionId, approved, approvedHunkIndices)
  })

  ipcMain.handle('agent:get-queue-status', async () => {
    return taskQueueAppService.getQueueStatus()
  })

  ipcMain.handle('agent:parse-tool-call', async (_, rawText: string) => {
    return parseAgentToolCall(rawText)
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
   * Pre-flight Clarification Interview: analyze user prompt for key architectural
   * and implementation trade-offs before drafting a plan.
   */
  ipcMain.handle(
    'agent:plan-interview',
    async (_, prompt: string, model: string | undefined, settings: AppSettings) => {
      return agentInterviewAppService.conductInterview(prompt, model, settings)
    }
  )

  /**
   * Enriches prompt with user's confirmed interview choices.
   */
  ipcMain.handle(
    'agent:plan-enrich-prompt',
    async (_, prompt: string, answers: any[]) => {
      return agentInterviewAppService.enrichPromptWithAnswers(prompt, answers)
    }
  )

  /**
   * Plan Approval flow: draft a plan for the given prompt, routed through the
   * hardware-profile Ollama runtime options and parsed via the canonical
   * GoalDecompositionPlanner parser (replaces the renderer's raw fetch()).
   */
  ipcMain.handle(
    'agent:plan-generate',
    async (_, prompt: string, model: string | undefined, settings: AppSettings, pendingResidueMilestones?: any[], workspacePath?: string | null) => {
      return planGenerationAppService.generatePlanText({ prompt, model, settings, pendingResidueMilestones, workspacePath })
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
    const state = await agentSessionStateAppService.loadSessionState(sessionId, workspacePath)
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
      return agentSessionStateAppService.seedPlanMilestones(sessionId, workspacePath, planMilestones, userTask)
    }
  )

  /**
   * Generates a comprehensive AI-optimized debug diagnostic bundle in Markdown
   * for troubleshooting and direct handover to an AI Assistant.
   */
  ipcMain.handle(
    'agent:export-ai-debug-bundle',
    async (_, options: {
      sessionId: string
      workspacePath?: string | null
      settings?: AppSettings
      activeModelName?: string
      activeSkills?: string[]
    }) => {
      return aiDebugBundleService.generateDebugBundle(options)
    }
  )
}
