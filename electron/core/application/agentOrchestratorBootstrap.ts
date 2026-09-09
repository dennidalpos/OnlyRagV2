import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AgentCompletionStatus, AgentExecutionMode, AppSettings, OllamaModelMetrics } from '../../../shared/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import type { StagnationCircuitBreaker } from '../domain/agent/stagnationCircuitBreaker'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { ResponseInterpreterState } from './agentOrchestratorResponseInterpreterTypes'
import type { ToolResultMutableFlags } from './agentOrchestratorToolResultTypes'
import type { AgentSession, ApprovalResponse } from './agentOrchestratorTypes'
import type { AgentExecutionPhaseController } from '../domain/agent/agentExecutionPhase'
import type { AgentLogEntry } from '../domain/agent/agentTypes'
import type { AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'
import { resolveSessionContext } from './agentOrchestratorSessionContext'
import { initializeSessionState } from './agentOrchestratorSessionState'
import { buildSessionPersistence } from './agentOrchestratorSessionPersistence'
import { armSessionWatchdog } from './agentOrchestratorSessionWatchdog'
import { redactSecrets } from '../../logRedactor'

export type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

export interface BootstrapParams {
  payload: AgentTaskPayload
  session: AgentSession
  sessionId: string
  isSessionActive: () => boolean
  /** Removes this run's session from the module-level registry (the Map lives in agentOrchestratorAppService.ts). */
  deregisterSession: () => void
}

/**
 * Everything runAgentOrchestratorLoop's turn loop needs after one-shot session setup:
 * resolved config/context strings, the loop-scoped state objects the turn-dispatch /
 * response-interpreter / tool-result-processor modules read and mutate in place, and the
 * closures (emitLog, persistCurrentState, requestApproval, finalizeSession, ...) that share that state by reference.
 */
export interface AgentSessionBootstrap {
  phaseController: AgentExecutionPhaseController
  userTask: string
  initialUserTask: string
  agentMode: AgentExecutionMode
  workspacePath: string | null
  isStandaloneMode: boolean
  settings: AppSettings
  attachedContext: string
  pinnedFilesContextStr: string
  projectContextMapStr: string
  availableModels: string[]
  codingModel: string
  modelCapabilities: Record<string, string[]>
  modelMetrics: Record<string, OllamaModelMetrics>
  skillMatchContext: SkillMatchContext
  skillMatchingOptions: SkillMatchingOptions
  skillsBlock: string
  resumeValidationError: string | null
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
  /** Frozen per-session Ollama context window. */
  sessionNumCtxBox: { value: number | null }
  /** Per-file line deltas applied during this session, for the UI's change metrics. */
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
  /** Boxed so both the timeout watchdog closure and the turn loop see the current step. */
  stepCountBox: { value: number }
  MAX_STEPS: number
  maxStepsLabel: string
  isUnlimitedSteps: boolean
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string, completionStatus?: AgentCompletionStatus) => void
  emitStepUpdate: (statusText?: string) => void
  persistCurrentState: (terminationReason?: AgentSessionTerminationReason, completionStatus?: AgentCompletionStatus) => Promise<void>
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  requestApproval: (approvalPayload: Record<string, unknown>) => Promise<ApprovalResponse>
  finalizeSession: () => void
  clearSessionTimeout: () => void
}

/**
 * One-shot per-session setup for runAgentOrchestratorLoop: resolves the task/workspace/
 * settings context, initializes the loop-scoped state machines and restores any saved
 * session, builds the persistence/reporting closures, and arms the session timeout
 * watchdog. See agentOrchestratorSessionContext/State/Persistence/Watchdog.ts for the four
 * steps this composes.
 */
export async function bootstrapAgentSession(params: BootstrapParams): Promise<AgentSessionBootstrap> {
  const { payload, session, sessionId, isSessionActive, deregisterSession } = params

  const emitLog: AgentSessionBootstrap['emitLog'] = (type, message, detail, meta) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:log', {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        type,
        ...meta,
        message: redactSecrets(message),
        detail: detail ? redactSecrets(detail) : undefined,
        target: meta?.target ? redactSecrets(meta.target) : meta?.target,
        testRun: meta?.testRun
          ? { ...meta.testRun, summary: redactSecrets(meta.testRun.summary) }
          : undefined,
      })
    }
  }

  const emitDone = (success: boolean, summary: string, completionStatus?: AgentCompletionStatus) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:done', { success, summary, completionStatus })
    }
  }

  const context = await resolveSessionContext({ payload, session, sessionId, emitLog })

  const state = await initializeSessionState({
    payload,
    sessionId,
    workspacePath: context.workspacePath,
    agentMode: context.agentMode,
    userTask: context.userTask,
    settings: context.settings,
    emitLog,
  })

  const persistence = buildSessionPersistence({
    sessionId,
    workspacePath: context.workspacePath,
    agentMode: context.agentMode,
    userTask: context.userTask,
    initialUserTask: state.initialUserTask,
    MAX_STEPS: state.MAX_STEPS,
    maxStepsLabel: state.maxStepsLabel,
    settings: context.settings,
    stepCountBox: state.stepCountBox,
    sessionChangedFiles: state.sessionChangedFiles,
    goalPlanner: state.goalPlanner,
    episodicCompactor: state.episodicCompactor,
    phaseController: state.phaseController,
    responseInterpreterState: state.responseInterpreterState,
    session,
    isSessionActive,
  })
  session.persistCancellation = () => persistence.persistCurrentState('cancelled', 'cancelled')

  const watchdog = armSessionWatchdog({
    session,
    sessionId,
    settings: context.settings,
    emitLog,
    emitDone,
    persistCurrentState: persistence.persistCurrentState,
    stepCountBox: state.stepCountBox,
    isSessionActive,
    deregisterSession,
  })

  return {
    ...context,
    ...state,
    ...persistence,
    ...watchdog,
    emitLog,
    emitDone,
  }
}
