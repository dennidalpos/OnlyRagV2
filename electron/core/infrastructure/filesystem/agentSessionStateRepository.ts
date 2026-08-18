import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../../../diagnostics'
import type { AgentMode } from '../../domain/agent/agentTypes'
import type { EpisodicStepRecord } from '../../domain/agent/episodicMemoryCompactor'
import type { PlanMilestone } from '../../domain/agent/planAndSolveGraph'
import { type CompactPlanState } from '../../domain/agent/planManager'
import { SessionDebtTracker } from '../../domain/agent/sessionDebtTracker'

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
  initialUserTask?: string
  updatedAt: string
  objective?: string
  restorePoint?: string
  activeMicroTask?: string
  pendingMicroTasks?: string[]
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
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

  /**
   * Writes .assistant/SESSION_TRACKER.md. Single writer, single format: the tracker is read
   * back with SessionDebtTracker.parseTrackerMarkdown (both by the next turn's prompt assembly
   * and by a resumed session), so it must be written in exactly that format. A second,
   * plan-shaped format used to be written here on every checkpoint, which the parser could
   * not read — the injected "previous turn debt" block was silently empty.
   */
  public async saveSessionTrackerMarkdown(
    workspacePath: string | null,
    tracker: SessionDebtTracker
  ): Promise<boolean> {
    if (!workspacePath || !fs.existsSync(workspacePath)) return false
    try {
      const assistantDir = path.join(workspacePath, '.assistant')
      if (!fs.existsSync(assistantDir)) {
        await fs.promises.mkdir(assistantDir, { recursive: true })
      }
      const trackerPath = path.join(assistantDir, 'SESSION_TRACKER.md')
      const markdown = tracker.compileTrackerMarkdown()
      const tempPath = `${trackerPath}.tmp`
      await fs.promises.writeFile(tempPath, markdown, 'utf-8')
      await fs.promises.rename(tempPath, trackerPath)
      return true
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed saving SESSION_TRACKER.md: ${err.message}`)
      return false
    }
  }

  public async loadSessionState(sessionId: string, workspacePath?: string | null): Promise<SavedAgentSessionState | null> {
    try {
      const filePath = this.getStateFilePath(sessionId, workspacePath)
      if (!fs.existsSync(filePath)) {
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

  /**
   * Seeds (or merges into existing) persisted session state with the
   * user-approved plan milestones, so that runAgentOrchestratorLoop's
   * restore-from-savedState path (see agentOrchestratorAppService.ts,
   * `goalPlanner.loadMilestones(savedState.planMilestones)`) picks up the
   * approved plan as GoalDecompositionPlanner's starting state instead of
   * only auto-detecting a (possibly different) plan from the model's first
   * turn. Called from the Plan Approval UI right before task execution starts.
   */
  public async seedPlanMilestones(
    sessionId: string,
    workspacePath: string | null,
    planMilestones: PlanMilestone[],
    userTask?: string
  ): Promise<boolean> {
    const existing = await this.loadSessionState(sessionId, workspacePath)
    const state: SavedAgentSessionState = existing
      ? { ...existing, planMilestones, updatedAt: new Date().toISOString() }
      : {
          sessionId,
          workspacePath,
          agentMode: 'agent',
          stepCount: 0,
          maxSteps: 50,
          episodes: [],
          recentFullLogs: [],
          planMilestones,
          userTask: userTask || '',
          updatedAt: new Date().toISOString(),
        }
    return this.saveSessionState(state)
  }

  public async clearSessionState(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    try {
      const filePath = this.getStateFilePath(sessionId, workspacePath)
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath)
      }
      const fallbackPath = path.join(
        os.homedir(),
        '.onlyrag_v2',
        'sessions',
        `.agent_state_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
      )
      if (fs.existsSync(fallbackPath)) {
        await fs.promises.unlink(fallbackPath)
      }
      return true
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed clearing session state for ${sessionId}: ${err.message}`)
      return false
    }
  }

  public async clearAllSessionStates(workspacePath?: string | null): Promise<boolean> {
    try {
      const dirs = [this.getStorageDir(workspacePath), path.join(os.homedir(), '.onlyrag_v2', 'sessions')]
      for (const dir of dirs) {
        if (fs.existsSync(dir)) {
          const files = await fs.promises.readdir(dir)
          for (const file of files) {
            if (file.startsWith('.agent_state_') && file.endsWith('.json')) {
              try {
                await fs.promises.unlink(path.join(dir, file))
              } catch (unlinkErr: any) {
                logger.log('WARN', 'AgentSessionStateRepo', `Failed deleting state file ${file}: ${unlinkErr.message}`)
              }
            }
          }
        }
      }
      return true
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed clearing all session states: ${err.message}`)
      return false
    }
  }
}

export const agentSessionStateRepository = new AgentSessionStateRepository()
