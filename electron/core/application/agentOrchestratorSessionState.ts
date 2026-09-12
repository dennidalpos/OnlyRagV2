import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AgentRunIdentity, AppSettings } from '../../../shared/types'
import type { ResponseInterpreterState } from './agentOrchestratorResponseInterpreterTypes'
import type { ToolResultMutableFlags } from './agentOrchestratorToolResultTypes'
import { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { GoalDecompositionPlanner, type PlanMilestone } from '../../../shared/domain/agent/planAndSolveGraph'
import { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import type { SavedAgentSessionState } from '../infrastructure/filesystem/agentSessionStateRepository'
import { matchesAgentRunIdentity } from '../../../shared/domain/agent/agentRunIdentity'
import { AgentExecutionPhaseController } from '../domain/agent/agentExecutionPhase'
import { captureMilestoneFileEvidence, createWorkspaceDeliverableProbe } from '../infrastructure/filesystem/workspaceDeliverableProbe'
import { resolveDeclaredFilePaths, resolveMilestoneDeliverableStatus } from '../../../shared/domain/agent/milestoneDeliverableResolver'

import type { AgentLogEntry } from '../domain/agent/agentTypes'

export type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

export interface SessionStateParams {
  payload: AgentTaskPayload
  sessionId: string
  runIdentity: Readonly<AgentRunIdentity>
  workspacePath: string | null
  agentMode: AgentExecutionMode
  userTask: string
  settings: AppSettings
  emitLog: EmitLog
}

/** Loop-scoped state machines, guards and counters, restored from any saved session state. */
export interface SessionState {
  phaseController: AgentExecutionPhaseController
  episodicCompactor: EpisodicMemoryCompactor
  goalPlanner: GoalDecompositionPlanner
  fsmMode: AgentRuntimeModeFsm
  executionGuard: TransactionalExecutionGuard
  circuitBreaker: StagnationCircuitBreaker
  loopDetector: AgentActionLoopDetector
  /** DoD violation reasons already surfaced to the model -- each intercepts `finish` at most once. */
  surfacedDodReasons: Set<string>
  mutableFlags: ToolResultMutableFlags
  responseInterpreterState: ResponseInterpreterState
  isUnlimitedSteps: boolean
  MAX_STEPS: number
  maxStepsLabel: string
  /** Boxed so both the timeout watchdog closure and the turn loop see the current step. */
  stepCountBox: { value: number }
  initialUserTask: string
  /** Frozen per-session Ollama context window. */
  sessionNumCtxBox: { value: number | null }
  /** Per-file line deltas applied during this session, for the UI's change metrics. */
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
}

export interface SavedRunStateSelection {
  executionState: SavedAgentSessionState | null
  planSeed: PlanMilestone[]
  initialUserTask?: string
}

/** Keeps recoverable execution state scoped to one immutable run identity. */
export function selectSavedRunState(
  savedState: SavedAgentSessionState | null,
  runIdentity: Readonly<AgentRunIdentity>
): SavedRunStateSelection {
  if (!savedState) return { executionState: null, planSeed: [] }

  if (savedState.status === 'IN_PROGRESS' && matchesAgentRunIdentity(savedState.runIdentity, runIdentity)) {
    return { executionState: savedState, planSeed: [] }
  }

  if (savedState.pendingPlanMilestones?.length) {
    return {
      executionState: null,
      planSeed: savedState.pendingPlanMilestones,
      initialUserTask: savedState.pendingPlanUserTask,
    }
  }

  // Compatibility for an untouched pre-run seed saved before run identities existed.
  const isLegacyPlanSeed = savedState.status === 'IN_PROGRESS'
    && !savedState.runIdentity
    && savedState.stepCount === 0
    && savedState.episodes.length === 0
    && !savedState.recoveryFailures?.schema
    && !savedState.recoveryFailures?.execution
  return isLegacyPlanSeed
    ? { executionState: null, planSeed: savedState.planMilestones, initialUserTask: savedState.initialUserTask || savedState.userTask }
    : { executionState: null, planSeed: [] }
}

/** Rechecks persisted evidence before a resumed intervention can remain verified. */
export function revalidateRestoredMilestones(
  milestones: readonly PlanMilestone[],
  workspacePath: string | null
): PlanMilestone[] {
  const probe = workspacePath ? createWorkspaceDeliverableProbe(workspacePath) : null
  return milestones.map((milestone) => {
    if (milestone.status !== 'verified') return milestone
    if (probe && resolveMilestoneDeliverableStatus(milestone, probe) === 'unsatisfied') {
      return { ...milestone, status: 'pending', notes: 'Persisted file evidence is stale; deliverables must be restored.' }
    }
    const declaredFiles = resolveDeclaredFilePaths(milestone)
    if (probe && declaredFiles.length > 0) {
      const currentEvidence = captureMilestoneFileEvidence(workspacePath!, milestone)
      const persistedEvidence = milestone.fileEvidence
      const fingerprintMatches = currentEvidence && persistedEvidence
        && declaredFiles.every((filePath) => currentEvidence[filePath] === persistedEvidence[filePath])
        && Object.keys(persistedEvidence).length === declaredFiles.length
      if (!fingerprintMatches) {
        return { ...milestone, status: 'pending', notes: 'Persisted file evidence changed; rerun milestone verification.' }
      }
    }
    if (milestone.verificationCommand) {
      return { ...milestone, status: 'in_progress', notes: 'Persisted command evidence is stale; rerun verification.' }
    }
    return milestone
  })
}

/**
 * Instantiates the loop-scoped state machines/guards/counters for a run and restores them
 * from any saved session state (resumed sessions carry stepCount, episodic memory and plan
 * milestones forward instead of starting cold).
 */
export async function initializeSessionState(params: SessionStateParams): Promise<SessionState> {
  const { payload, sessionId, runIdentity, workspacePath, agentMode, userTask, settings, emitLog } = params

  const episodicCompactor = new EpisodicMemoryCompactor(6)
  const phaseController = new AgentExecutionPhaseController()
  const goalPlanner = new GoalDecompositionPlanner()
  const fsmMode = new AgentRuntimeModeFsm(agentMode)
  const isUnlimitedSteps = settings.maxToolCallSteps === 0 || (settings.maxToolCallSteps !== undefined && settings.maxToolCallSteps >= 200)
  const MAX_STEPS = isUnlimitedSteps ? Infinity : Math.max(10, Math.min(200, settings.maxToolCallSteps || 50))
  const maxStepsLabel = MAX_STEPS === Infinity ? '∞' : String(MAX_STEPS)
  const stepCountBox = { value: 0 }
  // Bundled (rather than loose `let`s) because agentOrchestratorToolResultProcessor.ts
  // mutates these in place across steps -- see runToolResultProcessing.
  const mutableFlags: SessionState['mutableFlags'] = {
    hasFileMutations: false,
    hasVerifiedBuild: false,
  }
  // Same pattern, for the counters agentOrchestratorResponseInterpreter.ts advances.
  const responseInterpreterState: SessionState['responseInterpreterState'] = {
    noToolStreak: 0,
    schemaRejectionStreak: 0,
    stagnationStreak: 0,
    redundantSuccessStreak: 0,
    verificationFixCycles: 0,
  }
  const surfacedDodReasons = new Set<string>()
  const loopDetector = new AgentActionLoopDetector(2)
  const circuitBreaker = new StagnationCircuitBreaker(12, 5)
  const executionGuard = new TransactionalExecutionGuard(workspacePath || process.cwd())

  const savedState = await agentSessionStateRepository.loadSessionState(sessionId, workspacePath)
  const { executionState, planSeed, initialUserTask: seededInitialTask } = selectSavedRunState(savedState, runIdentity)
  const initialUserTask = executionState?.initialUserTask || seededInitialTask || payload.initialUserTask || userTask

  if (executionState) {
    responseInterpreterState.schemaRecoveryFailure = executionState.recoveryFailures?.schema
    responseInterpreterState.executionRecoveryFailure = executionState.recoveryFailures?.execution
    responseInterpreterState.pendingVersionConflictReadPath = executionState.recoveryFailures?.versionConflictReadPath
    responseInterpreterState.versionedReadEvidence = executionState.versionedReadEvidence
    responseInterpreterState.schemaRejectionStreak = executionState.recoveryFailures?.schema?.equivalentFailures || 0
    responseInterpreterState.verificationFixCycles = executionState.recoveryFailures?.verificationFixCycles || 0
    stepCountBox.value = executionState.stepCount || 0
    if (executionState.episodes && executionState.episodes.length > 0) {
      episodicCompactor.fromState(executionState.episodes, executionState.recentFullLogs)
    }
    if (executionState.planMilestones && executionState.planMilestones.length > 0) {
      const restoredMilestones = revalidateRestoredMilestones(executionState.planMilestones, workspacePath)
      goalPlanner.loadMilestones(restoredMilestones)
      const staleCount = restoredMilestones.filter((milestone, index) => milestone.status !== executionState.planMilestones[index].status).length
      if (staleCount > 0) emitLog('info', `♻️ ${staleCount} persisted milestone evidence marked for revalidation.`)
    }
    emitLog('info', `🔄 Restored Session State [${sessionId}]: Continuing from Step ${stepCountBox.value} with ${episodicCompactor.episodeCount} prior steps in memory.`)
  } else if (planSeed.length > 0) {
    goalPlanner.loadMilestones(planSeed)
    emitLog('info', `Loaded ${planSeed.length} approved plan milestones for this new run.`)
  }

  const sessionNumCtxBox: { value: number | null } = { value: null }
  const sessionChangedFiles = new Map<string, { additions: number; deletions: number }>()

  return {
    phaseController,
    episodicCompactor,
    goalPlanner,
    fsmMode,
    executionGuard,
    circuitBreaker,
    loopDetector,
    surfacedDodReasons,
    mutableFlags,
    responseInterpreterState,
    isUnlimitedSteps,
    MAX_STEPS,
    maxStepsLabel,
    stepCountBox,
    initialUserTask,
    sessionNumCtxBox,
    sessionChangedFiles,
  }
}
