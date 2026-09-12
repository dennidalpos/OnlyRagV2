import { ipcMain, BrowserWindow } from 'electron'
import { taskQueueAppService } from '../application/taskQueueAppService'
import { respondToApproval } from '../application/agentOrchestratorAppService'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { agentSessionStateAppService } from '../application/agentSessionStateAppService'
import { sidecarAppService } from '../application/sidecarAppService'
import { planGenerationAppService } from '../application/planGenerationAppService'
import { agentInterviewAppService } from '../application/agentInterviewAppService'
import { ollamaAppService } from '../application/ollamaAppService'
import { aiDebugBundleService } from '../application/aiDebugBundleService'
import { logger } from '../../diagnostics'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AgentPlan, AgentRunIdentity, AppSettings, InterviewQuestion, UserInterviewAnswer } from '../../../shared/types'
import { z } from 'zod'

const activeFileContextSchema = z.object({
  name: z.string().trim().min(1).max(260),
  path: z.string().trim().min(1).max(4096),
  content: z.string().max(120_000),
  versionHash: z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 content hash'),
}).strict()

/** Validates the only editor context accepted by an agent run. */
export function parseAgentTaskPayload(input: unknown): AgentTaskPayload {
  if (!input || typeof input !== 'object') throw new Error('Invalid agent task payload')
  const { contextFiles: _discardedContextFiles, ...payload } = input as Record<string, unknown>
  const result = z.object({ activeFile: activeFileContextSchema.nullable().optional() }).passthrough().safeParse(payload)
  if (!result.success) throw new Error(`Invalid activeFile contract: ${result.error.issues[0]?.message || 'unknown validation error'}`)
  return { ...payload, activeFile: result.data.activeFile ?? null } as AgentTaskPayload
}

export function registerAgentIpcHandlers(winGetter: () => BrowserWindow | null) {
  ipcMain.handle('agent:start-task', async (_, payload: unknown) => {
    return taskQueueAppService.scheduleAgentTask(parseAgentTaskPayload(payload), winGetter)
  })

  ipcMain.handle('agent:cancel-task', async (_, identity: AgentRunIdentity) => {
    return taskQueueAppService.cancelTask(identity)
  })

  ipcMain.handle('agent:approval-response', async (_, identity: AgentRunIdentity, approved: boolean, approvedHunkIndices?: number[]) => {
    return respondToApproval(identity, approved, approvedHunkIndices)
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
    return sidecarAppService.analyzeLogs(extraPaths)
  })

  /**
   * Pre-flight Clarification Interview: analyze user prompt for key architectural
   * and implementation trade-offs before drafting a plan.
   */
  ipcMain.handle(
    'agent:plan-interview',
    async (_, prompt: string, model: string | undefined, settings: AppSettings, workspacePath?: string | null, previousDecisions?: UserInterviewAnswer[], identity?: AgentRunIdentity) => {
      logger.log('INFO', 'AgentPlanIpc', `Interview requested (prompt length: ${prompt.length}, model: ${model || 'default'}).`)
      return identity?.runId
        ? agentInterviewAppService.conductInterview(prompt, model, settings, workspacePath, previousDecisions, identity.runId)
        : agentInterviewAppService.conductInterview(prompt, model, settings, workspacePath, previousDecisions)
    }
  )

  /**
   * Enriches prompt with user's confirmed interview choices.
   */
  ipcMain.handle(
    'agent:plan-enrich-prompt',
    async (_, prompt: string, answers: UserInterviewAnswer[], questions: InterviewQuestion[]) => {
      return agentInterviewAppService.enrichPromptWithAnswers(prompt, answers, questions)
    }
  )

  /**
   * Plan Approval flow: draft a plan for the given prompt, routed through the
   * hardware-profile Ollama runtime options and parsed via the canonical
   * GoalDecompositionPlanner parser (replaces the renderer's raw fetch()).
   */
  ipcMain.handle(
    'agent:plan-generate',
    async (_, prompt: string, model: string | undefined, settings: AppSettings, previousPlan?: AgentPlan, workspacePath?: string | null, previousDecisions?: UserInterviewAnswer[], identity?: AgentRunIdentity) => {
      logger.log('INFO', 'AgentPlanIpc', `Generation requested (prompt length: ${prompt.length}, model: ${model || 'default'}).`)
      return planGenerationAppService.generatePlanText({ prompt, model, settings, previousPlan, workspacePath, previousDecisions, operationId: identity?.runId })
    }
  )

  ipcMain.handle('agent:plan-cancel', async (_, identity: AgentRunIdentity) => {
    return { success: Boolean(identity?.runId) && ollamaAppService.cancelStructuredGeneration(identity.runId) }
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
