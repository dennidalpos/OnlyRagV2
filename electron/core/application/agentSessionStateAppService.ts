import type { PlanMilestone } from '../domain/agent/planAndSolveGraph'
import { agentSessionStateRepository, type SavedAgentSessionState } from '../infrastructure/filesystem/agentSessionStateRepository'

/** Application boundary for renderer-facing session runtime state operations. */
export class AgentSessionStateAppService {
  loadSessionState(sessionId: string, workspacePath?: string | null): Promise<SavedAgentSessionState | null> {
    return agentSessionStateRepository.loadSessionState(sessionId, workspacePath)
  }

  seedPlanMilestones(
    sessionId: string,
    workspacePath: string | null,
    planMilestones: PlanMilestone[],
    userTask?: string
  ): Promise<boolean> {
    return agentSessionStateRepository.seedPlanMilestones(sessionId, workspacePath, planMilestones, userTask)
  }
}

export const agentSessionStateAppService = new AgentSessionStateAppService()
