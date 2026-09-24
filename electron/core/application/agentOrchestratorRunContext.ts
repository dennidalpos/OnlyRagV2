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
import type { OllamaContextReuseDecision } from '../domain/agent/ollamaContextCacheManager'
import type { TurnToolPolicy } from '../domain/agent/turnToolPolicy'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { AgentSession, EmitLog } from './agentOrchestratorTypes'
import type { ApplicationClosureOutcome, ApplicationClosureRequest } from './agentOrchestratorApplicationClosureTypes'

/** The loop's mutable counters a tool step can flip. Mutated in place by design, like the AgentSession object. */
export interface ToolResultMutableFlags {
  hasFileMutations: boolean
  hasVerifiedBuild: boolean
}

/** Loop-scoped counters the turn phases read and advance across turns. */
export interface ResponseInterpreterState {
  /** Single progress policy: prose, schema, loop, redundancy, ask-redirect, execution and no-mutation budgets. */
  progress: AgentProgressPolicy
  /** Existing file that must be read before another edit is accepted. */
  pendingVersionConflictReadPath?: string
  /** Last content version the agent saw per file (read, full prompt injection or its own edit); see fileVersionEvidence.ts. */
  versionEvidence: FileVersionEvidence
  /** Rounds of "verification failed, fix it and try again" already spent on this session. */
  verificationFixCycles: number
  /** Every guard firing of this run (bounded), persisted and reported in the completion evidence. */
  guardEvents: AgentGuardEvent[]
}

/**
 * Everything run-scoped the turn phases share: the resolved task and model configuration, the
 * loop-scoped state objects they mutate in place, and the reporting/persistence callbacks. Built
 * once per run after bootstrap; each phase context adds only its own per-turn fields.
 */
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
  /** Exact model selected once during bootstrap and held for the execution. */
  codingModel: string
  modelCapabilities: Record<string, string[]>
  /** `/api/tags` facts per model tag. Carries the trained `context_length` that caps `num_ctx`. */
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
  /** DoD violation reasons already surfaced to the model -- each intercepts `finish` at most once. */
  surfacedDodReasons: Set<string>
  /** Per-file line deltas applied during this session, for the UI's change metrics. */
  sessionChangedFiles: Map<string, { additions: number; deletions: number }>
  /** Frozen per-session Ollama context window. */
  sessionNumCtxBox: { value: number | null }
  episodicCompactor: EpisodicMemoryCompactor
  goalPlanner: GoalDecompositionPlanner
  fsmMode: AgentRuntimeModeFsm
  executionGuard: TransactionalExecutionGuard
  /** Checked by the response interpreter and fed the real execution outcome by tool-result processing. */
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

/** Turn dispatch: model routing, prompt assembly and the LLM request. */
export type TurnDispatchContext = AgentRunContext & {
  stepCount: number
  skillsBlock?: string
  /** Optional hardware snapshot for deterministic callers/tests; production resolves it once upstream. */
  hardwareFacts?: HardwareFacts
}

export interface TurnDispatchData {
  streamedOutput: string
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
  targetModel: string
}

export interface PreparedAgentTurn {
  selection: ModelSelection
  assembled: { stableSection: string; historyBlock: string }
  turnPrompt: string
  contextReuseDecision: OllamaContextReuseDecision
  wasCompacted: boolean
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
  toolPolicy: TurnToolPolicy
}

export type TurnDispatchOutcome = { outcome: 'return'; result: AgentTaskResult } | { outcome: 'proceed'; data: TurnDispatchData }

export interface ModelSelection {
  targetModel: string
  targetModelToolCallingCapable: boolean
  targetModelToolCallingProbe: boolean
  runtimeOpts: OllamaRuntimeOptions
  /** The largest `num_ctx` Ollama will honour for `targetModel`: its trained `context_length`, as reported on `/api/tags`. */
  contextCeiling: number | null
}

/** Response interpretation: plan extraction, tool-call parsing and the finish/loop/ask special cases. */
export type ResponseInterpreterContext = AgentRunContext & {
  streamedOutput: string
  stepCount: number
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
}

export type ResponseInterpretationOutcome =
  | { outcome: 'continue' }
  | { outcome: 'return'; result: AgentTaskResult }
  | { outcome: 'proceed'; parsedTool: AgentToolCall }

/** Tool-result processing: recovery budgets, plan and verification bookkeeping after one executed tool. */
export type ToolResultProcessingContext = AgentRunContext & {
  toolRes: ClassifiedToolExecutionResult
  parsedTool: AgentToolCall
  /** Wall-clock ms captured immediately before the tool ran; used to attribute files a shell command touched (see commandTouchedFilesScanner.ts). */
  toolStartedAtMs: number
  stepCount: number
  targetModel: string
}

export type ToolResultProcessingOutcome = { outcome: 'continue' } | { outcome: 'return'; result: AgentTaskResult }
