import type { AgentTaskPayload, AgentTaskResult } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { OllamaRuntimeOptions } from '../domain/agent/hardwareProfileResolver'
import type { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import type { GoalDecompositionPlanner } from '../domain/agent/planAndSolveGraph'
import type { AgentRuntimeModeFsm } from '../domain/agent/agentRuntimeMode'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { AgentSession } from './agentOrchestratorAppService'

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
  fallbackModel: string
  runtimeOpts: OllamaRuntimeOptions
}
