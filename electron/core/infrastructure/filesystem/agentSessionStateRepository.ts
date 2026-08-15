import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../../../diagnostics'
import type { AgentMode } from '../../domain/agent/agentTypes'
import type { EpisodicStepRecord } from '../../domain/agent/episodicMemoryCompactor'
import type { PlanMilestone } from '../../domain/agent/planAndSolveGraph'

export interface SavedAgentSessionState {
  sessionId: string
  workspacePath: string | null
  agentMode: AgentMode
  stepCount: number
  maxSteps: number
  episodes: EpisodicStepRecord[]
  recentFullLogs: Array<{ step: number; tool: string; output: string }>
  planMilestones: PlanMilestone[]
  userTask: string
  updatedAt: string
}

export class AgentSessionStateRepository {
  private getStorageDir(workspacePath?: string | null): string {
    if (workspacePath && fs.existsSync(workspacePath)) {
      const stateDir = path.join(workspacePath, '.onlyrag')
      if (!fs.existsSync(stateDir)) {
        try {
          fs.mkdirSync(stateDir, { recursive: true })
        } catch (err: any) {
          logger.log('WARN', 'AgentSessionStateRepo', `Could not create .onlyrag dir in workspace: ${err.message}`)
        }
      }
      if (fs.existsSync(stateDir)) return stateDir
    }

    const fallbackDir = path.join(os.homedir(), '.onlyrag_v2', 'sessions')
    if (!fs.existsSync(fallbackDir)) {
      try {
        fs.mkdirSync(fallbackDir, { recursive: true })
      } catch (err: any) {
        logger.log('WARN', 'AgentSessionStateRepo', `Could not create fallback session dir: ${err.message}`)
      }
    }
    return fallbackDir
  }

  private getStateFilePath(sessionId: string, workspacePath?: string | null): string {
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const dir = this.getStorageDir(workspacePath)
    return path.join(dir, `.agent_state_${safeSessionId}.json`)
  }

  public async saveSessionState(state: SavedAgentSessionState): Promise<boolean> {
    try {
      const filePath = this.getStateFilePath(state.sessionId, state.workspacePath)
      const payload = JSON.stringify(state, null, 2)
      const tempPath = `${filePath}.tmp`
      await fs.promises.writeFile(tempPath, payload, 'utf-8')
      await fs.promises.rename(tempPath, filePath)
      return true
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed saving session state for ${state.sessionId}: ${err.message}`)
      return false
    }
  }

  public async loadSessionState(sessionId: string, workspacePath?: string | null): Promise<SavedAgentSessionState | null> {
    try {
      const filePath = this.getStateFilePath(sessionId, workspacePath)
      if (!fs.existsSync(filePath)) {
        // Also check fallback homedir location if workspace location not found
        const fallbackPath = path.join(os.homedir(), '.onlyrag_v2', 'sessions', `.agent_state_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
        if (!fs.existsSync(fallbackPath)) return null
        const rawFallback = await fs.promises.readFile(fallbackPath, 'utf-8')
        return JSON.parse(rawFallback) as SavedAgentSessionState
      }
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      return JSON.parse(raw) as SavedAgentSessionState
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed loading session state for ${sessionId}: ${err.message}`)
      return null
    }
  }

  public async clearSessionState(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    try {
      const filePath = this.getStateFilePath(sessionId, workspacePath)
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath)
      }
      return true
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed clearing session state for ${sessionId}: ${err.message}`)
      return false
    }
  }
}

export const agentSessionStateRepository = new AgentSessionStateRepository()
