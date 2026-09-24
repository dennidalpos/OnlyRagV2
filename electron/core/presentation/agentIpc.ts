import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import { secureIpcMain as ipcMain } from './secureIpcMain'
import { taskQueueAppService } from '../application/taskQueueAppService'
import { requestActiveAgentContextCompaction, respondToApproval } from '../application/agentOrchestratorAppService'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { agentSessionStateAppService } from '../application/agentSessionStateAppService'
import { analyzeLogs } from '../application/logDiagnosticsAppService'
import { planGenerationAppService } from '../application/planGenerationAppService'
import { agentInterviewAppService } from '../application/agentInterviewAppService'
import { ollamaAppService } from '../application/ollamaAppService'
import { aiDebugBundleService } from '../application/aiDebugBundleService'
import { skillInstallApprovalService } from '../application/skillInstallApprovalService'
import { logger } from '../infrastructure/logging/logger'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import { agentPlanSchema, agentTaskRequestSchema, planMilestoneSchema } from '../domain/agent/agentTaskContract'
import { sanitizeAppSettings } from '../domain/settings/appSettingsDomain'
import type { AgentPlan, AgentRunIdentity, AppSettings, InterviewQuestion, UserInterviewAnswer } from '../../../shared/types'

/** Validates the complete agent run request and normalizes its settings snapshot. */
export function parseAgentTaskPayload(input: unknown): AgentTaskPayload {
  const result = agentTaskRequestSchema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`Invalid agent task payload: ${issue ? `${issue.path.join('.') || '(root)'} ${issue.message}` : 'unknown validation error'}`)
  }
  const { settings, activeFile, ...rest } = result.data
  return { ...rest, activeFile: activeFile ?? null, ...(settings ? { settings: sanitizeAppSettings(settings) } : {}) }
}

export function registerAgentIpcHandlers(rendererEvents: RendererEventSink) {
  ipcMain.handle('agent:start-task', async (_, payload: unknown) => {
    return taskQueueAppService.scheduleAgentTask(parseAgentTaskPayload(payload), rendererEvents)
  })

  ipcMain.handle('agent:cancel-task', async (_, identity: AgentRunIdentity) => {
    return taskQueueAppService.cancelTask(identity)
  })

  ipcMain.on('agent:skill-install-response', (_event, payload: Partial<AgentRunIdentity> & { requestId?: string; approved?: boolean }) => {
    skillInstallApprovalService.handleResponse(payload)
  })

  ipcMain.handle('agent:approval-response', async (_, identity: AgentRunIdentity, approved: boolean, approvedHunkIndices?: number[]) => {
    return respondToApproval(identity, approved, approvedHunkIndices)
  })

  ipcMain.handle('agent:compact-context', async (_, identity: AgentRunIdentity) => {
    return requestActiveAgentContextCompaction(identity)
  })

  ipcMain.handle('agent:get-queue-status', async () => {
    return taskQueueAppService.getQueueStatus()
  })

  ipcMain.handle('agent:parse-tool-call', async (_, rawText: string) => {
    return parseAgentToolCall(rawText)
  })

  /** SLM Agent Studio: trigger log anomaly diagnostics analysis. */
  ipcMain.handle('agent:logs-analyze', async (_, extraPaths?: string[]) => {
    return analyzeLogs(extraPaths)
  })

  /**
   * Pre-flight Clarification Interview: analyze user prompt for key architectural
   * and implementation trade-offs before drafting a plan.
   */
  ipcMain.handle(
    'agent:plan-interview',
    async (
      _,
      prompt: string,
      model: string | undefined,
      settings: AppSettings,
      workspacePath?: string | null,
      previousDecisions?: UserInterviewAnswer[],
      identity?: AgentRunIdentity,
    ) => {
      logger.log('INFO', 'AgentPlanIpc', `Interview requested (prompt length: ${prompt.length}, model: ${model || 'default'}).`)
      return identity?.runId
        ? agentInterviewAppService.conductInterview(prompt, model, sanitizeAppSettings(settings), workspacePath, previousDecisions, identity.runId)
        : agentInterviewAppService.conductInterview(prompt, model, sanitizeAppSettings(settings), workspacePath, previousDecisions)
    },
  )

  /**
   * Enriches prompt with user's confirmed interview choices.
   */
  ipcMain.handle('agent:plan-enrich-prompt', async (_, prompt: string, answers: UserInterviewAnswer[], questions: InterviewQuestion[]) => {
    return agentInterviewAppService.enrichPromptWithAnswers(prompt, answers, questions)
  })

  /** Plan Approval flow: draft a plan for the given prompt, routed through the hardware-profile Ollama runtime options and parsed via the canonical GoalDecompositionPlanner parser (replaces the renderer's raw fetch()). */
  ipcMain.handle(
    'agent:plan-generate',
    async (
      _,
      prompt: string,
      model: string | undefined,
      settings: AppSettings,
      previousPlan?: AgentPlan,
      workspacePath?: string | null,
      previousDecisions?: UserInterviewAnswer[],
      identity?: AgentRunIdentity,
    ) => {
      logger.log('INFO', 'AgentPlanIpc', `Generation requested (prompt length: ${prompt.length}, model: ${model || 'default'}).`)
      return planGenerationAppService.generatePlanText({
        prompt,
        model,
        settings: sanitizeAppSettings(settings),
        // secureIpcMain only validates; parsing here strips keys the plan contract does not declare.
        previousPlan: previousPlan ? (agentPlanSchema.parse(previousPlan) as AgentPlan) : undefined,
        workspacePath,
        previousDecisions,
        operationId: identity?.runId,
      })
    },
  )

  ipcMain.handle('agent:plan-cancel', async (_, identity: AgentRunIdentity) => {
    return { success: Boolean(identity?.runId) && ollamaAppService.cancelStructuredGeneration(identity.runId) }
  })

  /** Exposes the backend's persisted plan milestone state (GoalDecompositionPlanner's completion truth, written by agentOrchestratorAppService.persistCurrentState) so the frontend can reflect verified/in-progress/failed status instead of guessing progress from step */
  ipcMain.handle('agent:get-plan-state', async (_, sessionId: string, workspacePath?: string | null, planRevisionId?: string) => {
    const state = await agentSessionStateAppService.loadSessionState(sessionId, workspacePath)
    if (!state) return null
    if (planRevisionId && state.runIdentity?.planRevisionId !== planRevisionId) return null
    return {
      planMilestones: state.planMilestones,
      status: state.status,
      stepCount: state.stepCount,
      ...(state.runIdentity?.planRevisionId ? { planRevisionId: state.runIdentity.planRevisionId } : {}),
    }
  })

  /** Seeds the approved plan's milestones into persisted session state before task execution starts, so runAgentOrchestratorLoop's restore-from-savedState path loads them into GoalDecompositionPlanner as its starting state. */
  ipcMain.handle(
    'agent:plan-seed',
    async (_, sessionId: string, workspacePath: string | null, planMilestones: unknown, userTask?: string, planRevisionId?: string) => {
      const milestones = planMilestoneSchema.array().parse(planMilestones)
      return agentSessionStateAppService.seedPlanMilestones(sessionId, workspacePath, milestones, userTask, planRevisionId)
    },
  )

  /**
   * Generates a comprehensive AI-optimized debug diagnostic bundle in Markdown
   * for troubleshooting and direct handover to an AI Assistant.
   */
  ipcMain.handle(
    'agent:export-ai-debug-bundle',
    async (
      _,
      options: {
        sessionId: string
        workspacePath?: string | null
        settings?: AppSettings
        activeModelName?: string
        activeSkills?: string[]
      },
    ) => {
      return aiDebugBundleService.generateDebugBundle({ ...options, settings: options.settings ? sanitizeAppSettings(options.settings) : undefined })
    },
  )
}
