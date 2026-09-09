import type { AgentTaskPayload, AgentTaskResult, AgentLogEntry } from '../domain/agent/agentTypes'
import type { AgentCompletionStatus, AgentExecutionMode, AppSettings, OllamaModelMetrics } from '../../../shared/types'
import type { OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../../../shared/domain/agent/planAndSolveGraph'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { AgentSession } from './agentOrchestratorTypes'
import type { ApplicationClosureOutcome, ApplicationClosureRequest } from './agentOrchestratorApplicationClosureTypes'

import type { HardwareFacts } from '../../../shared/domain/hardware/hardwareProfileTiers'
import type { OllamaContextReuseDecision } from '../domain/agent/ollamaContextCacheManager'
import type { TurnToolPolicy } from '../domain/agent/turnToolPolicy'
import type { ResponseInterpreterState } from './agentOrchestratorResponseInterpreterTypes'


export type EmitLog = (
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request',
  message: string,
  detail?: string,
  meta?: Partial<AgentLogEntry>
) => void

export interface TurnDispatchContext {
  userTask: string
  initialUserTask: string
  agentMode: AgentExecutionMode
  stepCount: number
  maxStepsLabel: string
  maxSteps: number
  workspacePath: string | null
  isStandaloneMode: boolean
  settings: AppSettings
  /** Optional hardware snapshot for deterministic callers/tests; production resolves it once upstream. */
  hardwareFacts?: HardwareFacts
  sessionId: string
  payload: AgentTaskPayload
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
  skillsBlock?: string
  episodicCompactor: EpisodicMemoryCompactor
  responseInterpreterState: ResponseInterpreterState
  goalPlanner: GoalDecompositionPlanner
  fsmMode: AgentRuntimeModeFsm
  /**
   * A real verification has passed and no file has been written since. Read by the plan block,
   * which stops demanding more work once the project is provably done — see
   * postVerificationClosure.ts.
   */
  hasVerifiedBuild: boolean
  session: AgentSession
  /** Frozen per-session Ollama context window. */
  sessionNumCtxBox: { value: number | null }
  isSessionActive: () => boolean
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string, completionStatus?: AgentCompletionStatus) => void
  persistCurrentState: () => Promise<void>
  finalizeSession: () => void
  closeApplicationRun: (request: ApplicationClosureRequest) => Promise<ApplicationClosureOutcome>
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

export type TurnDispatchOutcome =
  | { outcome: 'return'; result: AgentTaskResult }
  | { outcome: 'proceed'; data: TurnDispatchData }

export interface ModelSelection {
  targetModel: string
  targetModelToolCallingCapable: boolean
  targetModelToolCallingProbe: boolean
  runtimeOpts: OllamaRuntimeOptions
  /**
   * The largest `num_ctx` Ollama will honour for `targetModel`: its trained `context_length`,
   * as reported on `/api/tags`. Null when Ollama reported none, in which case nothing caps the
   * hardware profile's own sizing. `runtimeOpts` is already clamped to this — the field is kept
   * so diagnostics can explain the initial clamp.
   */
  contextCeiling: number | null
}
