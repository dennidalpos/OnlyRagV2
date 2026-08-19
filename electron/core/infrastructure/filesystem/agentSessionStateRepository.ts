import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../../../diagnostics'
import type { AgentMode } from '../../domain/agent/agentTypes'
import type { EpisodicStepRecord } from '../../domain/agent/episodicMemoryCompactor'
import type { PlanMilestone } from '../../domain/agent/planAndSolveGraph'
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
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
}

export class AgentSessionStateRepository {
  private getStorageDir(workspacePath?: string | null): string {
    if (workspacePath && fs.existsSync(workspacePath)) {
      const stateDir = path.join(workspacePath, '.onlyrag', 'sessions')
      if (!fs.existsSync(stateDir)) {
        try {
          fs.mkdirSync(stateDir, { recursive: true })
          this.migrateLegacyStateFiles(workspacePath, stateDir)
        } catch (err: any) {
          logger.log('WARN', 'AgentSessionStateRepo', `Could not create .onlyrag/sessions dir in workspace: ${err.message}`)
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

  /**
   * One-time move of `.agent_state_*.json` files left directly under the workspace's
   * `.onlyrag/` folder by the pre-unification layout (`.assistant/` + `.onlyrag/`), into
   * the new `.onlyrag/sessions/` subfolder, so existing sessions are not orphaned.
   */
  private migrateLegacyStateFiles(workspacePath: string, newStateDir: string): void {
    const legacyDir = path.join(workspacePath, '.onlyrag')
    try {
      const entries = fs.readdirSync(legacyDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith('.agent_state_') && entry.name.endsWith('.json')) {
          fs.renameSync(path.join(legacyDir, entry.name), path.join(newStateDir, entry.name))
        }
      }
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Legacy state migration skipped: ${err.message}`)
    }
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
   * Writes .onlyrag/assistant/SESSION_TRACKER.md. Single writer, single format: the tracker is
   * read back with SessionDebtTracker.parseTrackerMarkdown (both by the next turn's prompt
   * assembly and by a resumed session), so it must be written in exactly that format. A second,
   * plan-shaped format used to be written here on every checkpoint, which the parser could
   * not read — the injected "previous turn debt" block was silently empty.
   */
  public async saveSessionTrackerMarkdown(
    workspacePath: string | null,
    tracker: SessionDebtTracker
  ): Promise<boolean> {
    if (!workspacePath || !fs.existsSync(workspacePath)) return false
    try {
      const assistantDir = path.join(workspacePath, '.onlyrag', 'assistant')
      if (!fs.existsSync(assistantDir)) {
        await fs.promises.mkdir(assistantDir, { recursive: true })
        await this.migrateLegacyTracker(workspacePath, assistantDir)
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

  /** Reads back SESSION_TRACKER.md's raw markdown, or null if the workspace has none yet. */
  public loadSessionTrackerMarkdown(workspacePath: string): string | null {
    try {
      const trackerPath = path.join(workspacePath, '.onlyrag', 'assistant', 'SESSION_TRACKER.md')
      if (!fs.existsSync(trackerPath)) return null
      return fs.readFileSync(trackerPath, 'utf-8')
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed reading SESSION_TRACKER.md: ${err.message}`)
      return null
    }
  }

  /** One-time move of a pre-unification `.assistant/SESSION_TRACKER.md` into the new folder. */
  private async migrateLegacyTracker(workspacePath: string, newAssistantDir: string): Promise<void> {
    const legacyPath = path.join(workspacePath, '.assistant', 'SESSION_TRACKER.md')
    try {
      if (fs.existsSync(legacyPath)) {
        await fs.promises.rename(legacyPath, path.join(newAssistantDir, 'SESSION_TRACKER.md'))
      }
    } catch (err: any) {
      logger.log('WARN', 'AgentSessionStateRepo', `Legacy tracker migration skipped: ${err.message}`)
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
