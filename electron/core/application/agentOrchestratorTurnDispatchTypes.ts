import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import type { OllamaModelMetrics } from '../infrastructure/http/ollamaHttpClient'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { AgentSession } from './agentOrchestratorTypes'

import type { AgentLogEntry } from '../domain/agent/agentTypes'

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
  sessionId: string
  payload: AgentTaskPayload
  availableModels: string[]
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
  goalPlanner: GoalDecompositionPlanner
  fsmMode: AgentRuntimeModeFsm
  currentOverriddenModel: string | null
  /**
   * A real verification has passed and no file has been written since. Read by the plan block,
   * which stops demanding more work once the project is provably done — see
   * postVerificationClosure.ts.
   */
  hasVerifiedBuild: boolean
  session: AgentSession
  /** Frozen per-session Ollama context window, boxed so this module can grow it in place. */
  sessionNumCtxBox: { value: number | null }
  isSessionActive: () => boolean
  emitLog: EmitLog
  emitDone: (success: boolean, summary: string) => void
  persistCurrentState: () => Promise<void>
  finalizeSession: () => void
}

export interface TurnDispatchData {
  streamedOutput: string
  hasRecentToolFailure: boolean
  errorCountInHistory: number
  compiledHistoryBlock: string
  targetModel: string
  fallbackModel: string
}

export type TurnDispatchOutcome =
  | { outcome: 'return'; result: AgentTaskResult }
  | { outcome: 'proceed'; data: TurnDispatchData }

export interface ModelSelection {
  targetModel: string
  targetModelToolCallingCapable: boolean
  targetModelToolCallingProbe: boolean
  fallbackModel: string
  runtimeOpts: OllamaRuntimeOptions
  /**
   * The largest `num_ctx` Ollama will honour for `targetModel`: its trained `context_length`,
   * as reported on `/api/tags`. Null when Ollama reported none, in which case nothing caps the
   * hardware profile's own sizing. `runtimeOpts` is already clamped to this — the field is kept
   * so the per-turn growth in freezeOrGrowContextWindow cannot climb back over the ceiling.
   */
  contextCeiling: number | null
}
