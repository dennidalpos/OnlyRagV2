import fs from 'node:fs'
import { workspaceMetadataSessionDirectory, workspaceMetadataStatePath, workspaceMetadataTrackerPath } from './workspaceMetadataDirectory'
import path from 'node:path'
import { logger } from '../logging/logger'
import type { AgentMode } from '../../domain/agent/agentTypes'
import type { EpisodicStepRecord } from '../../domain/agent/episodicMemoryCompactor'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { AgentCompletionStatus, AgentGuardEvent, AgentGuardId, AgentRunIdentity, AgentVerificationEvidence } from '../../../../shared/types'
import { SessionDebtTracker } from '../../domain/agent/sessionDebtTracker'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { userDataSessionsDir } from './userDataRoot'
import type { AgentExecutionPhase } from '../../domain/agent/agentExecutionPhase'
import type { RecoveryFailureState } from '../../domain/agent/recoveryBudget'
import type { OllamaGenerationTelemetry, OllamaSessionRuntimeProfile } from '../../domain/agent/ollamaSessionRuntime'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'
import type { AgentChatMessage } from '../http/agentStreamTransport'

export type AgentSessionTerminationReason =
  | 'finish'
  | 'step_budget'
  | 'cancelled'
  | 'timeout'
  | 'circuit_breaker'
  | 'verification_failed'
  | 'model_silence'
  | 'transport_error'
  | 'runtime_validation'
  | 'protocol_error'
  | 'plan_proposal'

export interface SavedAgentSessionState {
  sessionId: string
  /** Execution state belongs to this run, never implicitly to the whole conversation. */
  runIdentity?: AgentRunIdentity
  workspacePath: string | null
  agentMode: AgentMode
  stepCount: number
  maxSteps: number
  episodes: EpisodicStepRecord[]
  recentFullLogs: Array<{ step: number; tool: string; output: string; isFailure?: boolean; target?: string }>
  planMilestones: PlanMilestone[]
  /** Approved plan awaiting the next run; distinct from a run's mutable milestones. */
  pendingPlanMilestones?: PlanMilestone[]
  pendingPlanUserTask?: string
  /** Revision that owns the pending plan seed. */
  pendingPlanRevisionId?: string
  userTask: string
  initialUserTask?: string
  updatedAt: string
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  /** Present only after a terminal path persists its final checkpoint. */
  terminationReason?: AgentSessionTerminationReason
  /** Evidence-based outcome of an application-owned terminal path. */
  completionStatus?: AgentCompletionStatus
  /** Last application-owned phase; absent in sessions saved before CAS-11. */
  executionPhase?: AgentExecutionPhase
  recoveryFailures?: {
    schema?: RecoveryFailureState
    execution?: RecoveryFailureState
    versionConflictReadPath?: string
    verificationFixCycles?: number
  }
  /** Per-file content versions the agent may edit against (normalized path -> sha256). */
  versionEvidence?: Record<string, string>
  /** Guard firings of the run, oldest first (bounded by MAX_GUARD_EVENTS). */
  guardEvents?: AgentGuardEvent[]
  /** Guard whose `stop` ended the run; distinguishes the causes folded into terminationReason 'circuit_breaker'. */
  terminationGuard?: AgentGuardId
  ollamaRuntimeProfile?: OllamaSessionRuntimeProfile
  ollamaGenerationTelemetry?: OllamaGenerationTelemetry[]
  lastVerification?: AgentVerificationEvidence
  chatMessages?: AgentChatMessage[]
}

function normalizePersistedMode(raw: unknown): SavedAgentSessionState {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const mode = record.agentMode
  const agentMode: AgentMode = mode === 'ask' || mode === 'guided' || mode === 'auto' ? mode : 'guided'
  return { ...record, agentMode } as SavedAgentSessionState
}

export class AgentSessionStateRepository {
  private getStateFilePath(sessionId: string, workspacePath?: string | null): string {
    if (workspacePath && fs.existsSync(workspacePath)) return workspaceMetadataStatePath(workspacePath, sessionId)
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(userDataSessionsDir(), `.agent_state_${safeSessionId}.json`)
  }

  public async saveSessionState(state: SavedAgentSessionState): Promise<boolean> {
    const filePath = this.getStateFilePath(state.sessionId, state.workspacePath)
    try {
      const payload = JSON.stringify(state, null, 2)
      return await safeAtomicWrite(filePath, payload)
    } catch (err: unknown) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed saving session state for ${state.sessionId}: ${errorMessage(err)}`)
      return false
    }
  }

  /** Writes the tracker owned by this conversation. */
  public async saveSessionTrackerMarkdown(workspacePath: string | null, tracker: SessionDebtTracker): Promise<boolean> {
    if (!workspacePath || !fs.existsSync(workspacePath)) return false
    try {
      const sessionId = tracker.getData().sessionId
      if (!sessionId) throw new Error('Session tracker has no owner')
      const trackerPath = workspaceMetadataTrackerPath(workspacePath, sessionId)
      await fs.promises.mkdir(path.dirname(trackerPath), { recursive: true })
      const markdown = tracker.compileTrackerMarkdown()
      return await safeAtomicWrite(trackerPath, markdown)
    } catch (err: unknown) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed saving SESSION_TRACKER.md: ${errorMessage(err)}`)
      return false
    }
  }

  /** Reads back SESSION_TRACKER.md's raw markdown, or null if the workspace has none yet. */
  public loadSessionTrackerMarkdown(workspacePath: string, sessionId: string): string | null {
    try {
      const trackerPath = workspaceMetadataTrackerPath(workspacePath, sessionId)
      if (!fs.existsSync(trackerPath)) return null
      return fs.readFileSync(trackerPath, 'utf-8')
    } catch (err: unknown) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed reading SESSION_TRACKER.md: ${errorMessage(err)}`)
      return null
    }
  }

  public async loadSessionState(sessionId: string, workspacePath?: string | null): Promise<SavedAgentSessionState | null> {
    try {
      const filePath = this.getStateFilePath(sessionId, workspacePath)
      if (!fs.existsSync(filePath)) {
        const fallbackPath = path.join(userDataSessionsDir(), `.agent_state_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
        if (!fs.existsSync(fallbackPath)) return null
        const rawFallback = await fs.promises.readFile(fallbackPath, 'utf-8')
        return normalizePersistedMode(JSON.parse(rawFallback))
      }
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      return normalizePersistedMode(JSON.parse(raw))
    } catch (err: unknown) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed loading session state for ${sessionId}: ${errorMessage(err)}`)
      return null
    }
  }

  /** Seeds (or merges into existing) persisted session state with the user-approved plan milestones, so that runAgentOrchestratorLoop's restore-from-savedState path (see agentOrchestratorAppService.ts, `goalPlanner.loadMilestones(savedState.planMilestones)`) picks */
  public async seedPlanMilestones(
    sessionId: string,
    workspacePath: string | null,
    planMilestones: PlanMilestone[],
    userTask?: string,
    planRevisionId?: string,
  ): Promise<boolean> {
    const existing = await this.loadSessionState(sessionId, workspacePath)
    const state: SavedAgentSessionState = existing
      ? {
          ...existing,
          pendingPlanMilestones: planMilestones,
          ...(userTask !== undefined ? { pendingPlanUserTask: userTask } : {}),
          ...(planRevisionId !== undefined ? { pendingPlanRevisionId: planRevisionId } : {}),
          updatedAt: new Date().toISOString(),
        }
      : {
          sessionId,
          workspacePath,
          agentMode: 'guided',
          stepCount: 0,
          maxSteps: 0,
          episodes: [],
          recentFullLogs: [],
          planMilestones,
          pendingPlanMilestones: planMilestones,
          pendingPlanUserTask: userTask || '',
          pendingPlanRevisionId: planRevisionId,
          userTask: userTask || '',
          updatedAt: new Date().toISOString(),
          status: 'IN_PROGRESS',
        }
    return this.saveSessionState(state)
  }

  public async clearSessionState(sessionId: string, workspacePath?: string | null): Promise<boolean> {
    try {
      if (workspacePath && fs.existsSync(workspacePath)) {
        await fs.promises.rm(workspaceMetadataSessionDirectory(workspacePath, sessionId), { recursive: true, force: true })
      }
      const fallbackPath = path.join(userDataSessionsDir(), `.agent_state_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
      if (fs.existsSync(fallbackPath) && (!workspacePath || JSON.parse(await fs.promises.readFile(fallbackPath, 'utf-8')).workspacePath === workspacePath)) {
        await fs.promises.unlink(fallbackPath)
      }
      return true
    } catch (err: unknown) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed clearing session state for ${sessionId}: ${errorMessage(err)}`)
      return false
    }
  }

  public async clearAllSessionStates(workspacePath?: string | null): Promise<boolean> {
    try {
      if (workspacePath && fs.existsSync(workspacePath)) {
        const sessionsDir = path.dirname(workspaceMetadataStatePath(workspacePath, 'probe'))
        const root = path.dirname(sessionsDir)
        if (fs.existsSync(root)) {
          for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
            if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) {
              await fs.promises.rm(path.join(root, entry.name), { recursive: true, force: true })
            }
          }
        }
      }
      const fallbackDir = userDataSessionsDir()
      if (fs.existsSync(fallbackDir)) {
        for (const file of await fs.promises.readdir(fallbackDir)) {
          if (!file.startsWith('.agent_state_') || !file.endsWith('.json')) continue
          const filePath = path.join(fallbackDir, file)
          const state = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as { workspacePath?: string | null }
          if (!workspacePath || state.workspacePath === workspacePath) await fs.promises.unlink(filePath)
        }
      }
      return true
    } catch (err: unknown) {
      logger.log('WARN', 'AgentSessionStateRepo', `Failed clearing all session states: ${errorMessage(err)}`)
      return false
    }
  }
}

export const agentSessionStateRepository = new AgentSessionStateRepository()
