import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AgentExecutionMode, AppSettings } from '../../../src/types'
import type { SkillMatchContext } from '../domain/skills/skillMatcher'
import type { SkillMatchingOptions } from './skillAppService'
import type { AgentSession } from './agentOrchestratorAppService'

export type EmitLog = (type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => void

export interface SessionContextParams {
  payload: AgentTaskPayload
  session: AgentSession
  sessionId: string
  emitLog: EmitLog
}

/** Resolved task/workspace/settings and the context blocks assembled once per session. */
export interface SessionContext {
  userTask: string
  agentMode: AgentExecutionMode
  workspacePath: string | null
  isStandaloneMode: boolean
  settings: AppSettings
  attachedContext: string
  pinnedFilesContextStr: string
  projectContextMapStr: string
  availableModels: string[]
  modelCapabilities: Record<string, string[]>
  skillMatchContext: SkillMatchContext
  skillMatchingOptions: SkillMatchingOptions
}
