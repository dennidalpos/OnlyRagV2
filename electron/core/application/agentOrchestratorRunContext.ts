import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import type {
  AgentCompletionEvidence,
  AgentCompletionStatus,
  AgentExecutionMode,
  AgentGuardEvent,
  AgentRunIdentity,
  AppSettings,
  OllamaModelMetrics,
} from '../../../shared/types'
import type { AgentTaskPayload, AgentTaskResult, AgentToolCall } from '../domain/agent/agentTypes'
import type { ClassifiedToolExecutionResult } from './agentToolExecutorService'
import type { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { HardwareFacts } from '../../../shared/domain/hardware/hardwareProfileTiers'
import type { TransactionalExecutionGuard } from '../infrastructure/filesystem/transactionalExecutionGuard'
import type { AgentSessionTerminationReason } from '../infrastructure/filesystem/agentSessionStateRepository'
import type { AgentProgressPolicy } from '../domain/agent/agentProgressPolicy'
import type { FileVersionEvidence } from '../domain/agent/fileVersionEvidence'
import type { AgentActionLoopDetector } from '../domain/agent/loopDetector'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { SessionDebtTracker } from '../domain/agent/sessionDebtTracker'
import type { OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import type { TurnToolPolicy } from '../domain/agent/turnToolPolicy'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { AgentSession, EmitLog } from './agentOrchestratorTypes'
import type { ApplicationClosureOutcome, ApplicationClosureRequest } from './agentOrchestratorApplicationClosureTypes'
import type { AgentChatToolCall } from '../infrastructure/http/agentStreamTransport'
import type { AssembledPrompt } from '../domain/agent/agentPromptAssembler'

/** Tool step mutable outcome flags. */
export interface ToolResultMutableFlags {
  hasFileMutations: boolean
  hasVerifiedBuild: boolean
}

/** Loop-scoped state shared across turns. */
export interface ResponseInterpreterState {
  /** Progress policy enforcing execution budgets. */
  progress: AgentProgressPolicy
  /** Path requiring read before next edit due to version conflict. */
  pendingVersionConflictReadPath?: string
  /** File version evidence per tracked path. */
  versionEvidence: FileVersionEvidence
  /** Count of verification fix cycles spent. */
  verificationFixCycles: number
  /** Guard events recorded during run. */
  guardEvents: AgentGuardEvent[]
}

/** Shared run-scoped execution context across turn phases. */
export interface AgentRunContext {
  session: AgentSession
  payload: AgentTaskPayload
  sessionId: string
  runIdentity: Readonly<AgentRunIdentity>
  userTask: string
  initialUserTask: string
  agentMode: AgentExecutionMode
  workspacePath: string | null
  isStandaloneMode: boolean
  settings: AppSettings
  availableModels: string[]
  codingModel: string
  modelCapabilities: Record<string, string[]>
  /** Model metrics from /api/tags including trained context length ceiling. */
  modelMetrics: Record<string, OllamaModelMetrics>
  attachedContext: string
  pinnedFilesContextStr: string
  projectContextMapStr: string
  skillMatchContext: SkillMatchContext
  skillMatchingOptions: SkillMatchingOptions
  maxSteps: number
  maxStepsLabel: string
  isUnlimitedSteps: boolean
  flags: ToolResultMutableFlags
  state: ResponseInterpreterState
  /** Surfaced DoD violation reasons intercepting finish. */
  surfacedDodReasons: Set<string>
  /** Per-file line deltas applied during session. */
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
  /** Frozen per-session Ollama num_ctx. */
  sessionNumCtxBox: { value: number | null }
  episodicCompactor: EpisodicMemoryCompactor
  goalPlanner: GoalDecompositionPlanner
  fsmMode: AgentRuntimeModeFsm
  executionGuard: TransactionalExecutionGuard
  /** Loop detector tracking repeated action sequences. */
  loopDetector: AgentActionLoopDetector
  rendererEvents: RendererEventSink | null
  isSessionActive: () => boolean
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string, completionStatus?: AgentCompletionStatus, evidence?: AgentCompletionEvidence) => void
  persistCurrentState: (terminationReason?: AgentSessionTerminationReason, completionStatus?: AgentCompletionStatus) => Promise<void>
  finalizeSession: () => void
  buildSessionTracker: (summaryText?: string) => SessionDebtTracker
  closeApplicationRun: (request: ApplicationClosureRequest) => Promise<ApplicationClosureOutcome>
  recordChangedFile?: (filePath: string) => void
  recordNonRollbackEffect?: (effect: string) => void
}

/** Turn dispatch: model routing, prompt assembly and LLM request. */
export type TurnDispatchContext = AgentRunContext & {
  stepCount: number
  skillsBlock?: string
  /** Hardware snapshot for model/budget resolution. */
  hardwareFacts?: HardwareFacts
}

export interface TurnDispatchData {
  streamedOutput: string
  nativeCalls?: AgentChatToolCall[]
  nativeBatchSize?: number
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
  targetModel: string
}

export interface PreparedAgentTurn {
  selection: ModelSelection
  assembled: AssembledPrompt
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
  toolPolicy: TurnToolPolicy
}

export type TurnDispatchOutcome = { outcome: 'return'; result: AgentTaskResult } | { outcome: 'proceed'; data: TurnDispatchData }

export interface ModelSelection {
  targetModel: string
  runtimeOpts: OllamaRuntimeOptions
  /** Model trained context length ceiling. */
  contextCeiling: number | null
}

/** Response interpretation context. */
export type ResponseInterpreterContext = AgentRunContext & {
  streamedOutput: string
  nativeCall?: AgentChatToolCall
  stepCount: number
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
}

export type ResponseInterpretationOutcome =
  | { outcome: 'continue' }
  | { outcome: 'return'; result: AgentTaskResult }
  | { outcome: 'proceed'; parsedTool: AgentToolCall }

/** Tool result processing context. */
export type ToolResultProcessingContext = AgentRunContext & {
  toolRes: ClassifiedToolExecutionResult
  parsedTool: AgentToolCall
  /** Wall-clock start timestamp in ms. */
  toolStartedAtMs: number
  stepCount: number
  targetModel: string
}

export type ToolResultProcessingOutcome = { outcome: 'continue' } | { outcome: 'return'; result: AgentTaskResult }
