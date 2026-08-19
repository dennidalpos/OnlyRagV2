import { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import { TransactionalExecutionGuard } from '../domain/agent/transactionalExecutionGuard'
import { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import type { SessionStateParams, SessionState } from './agentOrchestratorSessionStateTypes'

export type { SessionStateParams, SessionState } from './agentOrchestratorSessionStateTypes'

/**
 * Instantiates the loop-scoped state machines/guards/counters for a run and restores them
 * from any saved session state (resumed sessions carry stepCount, episodic memory and plan
 * milestones forward instead of starting cold).
 */
export async function initializeSessionState(params: SessionStateParams): Promise<SessionState> {
  const { payload, sessionId, workspacePath, agentMode, userTask, settings, emitLog } = params

  const episodicCompactor = new EpisodicMemoryCompactor(6)
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
    currentOverriddenModel: null,
  }
  // Same pattern, for the counters agentOrchestratorResponseInterpreter.ts advances.
  const responseInterpreterState: SessionState['responseInterpreterState'] = {
    noToolStreak: 0,
    stagnationStreak: 0,
    consecutiveAskAttempts: 0,
  }
  const surfacedDodReasons = new Set<string>()
  const loopDetector = new AgentActionLoopDetector(2)
  const circuitBreaker = new StagnationCircuitBreaker(10, 5)
  const executionGuard = new TransactionalExecutionGuard(workspacePath || process.cwd())

  // Restore session state if resuming an existing session
  const savedState = await agentSessionStateRepository.loadSessionState(sessionId, workspacePath)
  const initialUserTask = savedState?.initialUserTask || payload.initialUserTask || userTask

  if (savedState) {
    stepCountBox.value = savedState.stepCount || 0
    if (savedState.episodes && savedState.episodes.length > 0) {
      episodicCompactor.fromState(savedState.episodes, savedState.recentFullLogs)
    }
    if (savedState.planMilestones && savedState.planMilestones.length > 0) {
      goalPlanner.loadMilestones(savedState.planMilestones)
    }
    emitLog('info', `🔄 Restored Session State [${sessionId}]: Continuing from Step ${stepCountBox.value} with ${episodicCompactor.episodeCount} prior steps in memory.`)
  }

  const sessionNumCtxBox: { value: number | null } = { value: null }
  const sessionChangedFiles = new Map<string, { additions: number; deletions: number }>()

  return {
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
