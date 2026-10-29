import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type {
  AgentApprovalPayload,
  AgentCompletionEvidence,
  AgentCompletionStatus,
  AgentExecutionMode,
  AppSettings,
  OllamaModelMetrics,
} from '../../../shared/types'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillDefinition } from '../domain/skills/skillTypes'
import type { SkillMatchingOptions } from './skillAppService'
import type { ResponseInterpreterState } from './agentOrchestratorRunContext'
import type { ToolResultMutableFlags } from './agentOrchestratorRunContext'
import type { AgentSession, ApprovalResponse } from './agentOrchestratorTypes'
import type { AgentExecutionPhaseController } from '../domain/agent/agentExecutionPhase'
import type { EmitLog } from './agentOrchestratorTypes'
import type { AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'
import { resolveSessionContext } from './agentOrchestratorSessionContext'
import { initializeSessionState } from './agentOrchestratorSessionState'
import { buildSessionPersistence } from './agentOrchestratorSessionPersistence'
import { armSessionWatchdog } from './agentOrchestratorSessionWatchdog'
import { redactSecrets } from '../../logRedactor'
import { mapAgentLocalizedStrings } from '../../../shared/domain/agent/agentMainText'

export interface BootstrapParams {
  payload: AgentTaskPayload
  session: AgentSession
  sessionId: string
  isSessionActive: () => boolean
  /** Removes this run's session from the module-level registry (the Map lives in agentOrchestratorAppService.ts). */
  deregisterSession: () => void
}

/** Everything runAgentOrchestratorLoop's turn loop needs after one-shot session setup: resolved config/context strings, the loop-scoped state objects the turn-dispatch / response-interpreter / tool-result-processor modules read and mutate in place, and the closur */
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
  matchedSkills: SkillDefinition[]
  resumeValidationError: string | null
  episodicCompactor: EpisodicMemoryCompactor
  goalPlanner: GoalDecompositionPlanner
  fsmMode: AgentRuntimeModeFsm
  executionGuard: TransactionalExecutionGuard
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
  emitDone: (success: boolean, summary: string, completionStatus?: AgentCompletionStatus, evidence?: AgentCompletionEvidence) => void
  emitStepUpdate: (statusText?: string) => void
  persistCurrentState: (terminationReason?: AgentSessionTerminationReason, completionStatus?: AgentCompletionStatus) => Promise<void>
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  requestApproval: (approvalPayload: AgentApprovalPayload) => Promise<ApprovalResponse>
  finalizeSession: () => void
  clearSessionTimeout: () => void
}

/** One-shot per-session setup for runAgentOrchestratorLoop: resolves the task/workspace/ settings context, initializes the loop-scoped state machines and restores any saved session, builds the persistence/reporting closures, and arms the session timeout watchdog. */
export async function bootstrapAgentSession(params: BootstrapParams): Promise<AgentSessionBootstrap> {
  const { payload, session, sessionId, isSessionActive, deregisterSession } = params

  const emitLog: AgentSessionBootstrap['emitLog'] = (type, message, detail, meta) => {
    if (isSessionActive() && session.rendererEvents?.isAvailable()) {
      session.rendererEvents.send('agent:log', {
        ...session.identity,
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        type,
        ...meta,
        message: redactSecrets(message),
        detail: detail ? redactSecrets(detail) : undefined,
        target: meta?.target ? redactSecrets(meta.target) : meta?.target,
        testRun: meta?.testRun ? { ...meta.testRun, summary: redactSecrets(meta.testRun.summary) } : undefined,
        localized: meta?.localized ? mapAgentLocalizedStrings(meta.localized, redactSecrets) : undefined,
      })
    }
  }

  const emitDone = (success: boolean, summary: string, completionStatus?: AgentCompletionStatus, evidence?: AgentCompletionEvidence) => {
    if (isSessionActive() && session.rendererEvents?.isAvailable()) {
      session.rendererEvents.send('agent:done', { ...session.identity, success, summary, completionStatus, evidence })
    }
  }

  const context = await resolveSessionContext({ payload, session, sessionId, emitLog })

  const state = await initializeSessionState({
    payload,
    sessionId,
    runIdentity: session.identity,
    workspacePath: context.workspacePath,
    agentMode: context.agentMode,
    userTask: context.userTask,
    settings: context.settings,
    emitLog,
  })
  // The chat opens with the conversation's first task (see agentOrchestratorTurnDispatch); a follow-up
  // request comes after the transcript it follows, once, as the user's next message.
  if (!context.resumesRun && context.userTask.trim() !== state.initialUserTask.trim()) {
    session.chatMessages = [...(session.chatMessages || []), { role: 'user', content: context.userTask }]
  }

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
