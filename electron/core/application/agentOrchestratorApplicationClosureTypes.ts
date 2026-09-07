import type { AgentTaskResult } from '../domain/agent/agentTypes'

export type ApplicationClosureTrigger =
  | 'finish'
  | 'model_silence'
  | 'step_budget'
  | 'transport_error'
  | 'protocol_error'
  | 'guard_stop'

export interface ApplicationClosureRequest {
  trigger: ApplicationClosureTrigger
  reason: string
  modelSummary?: string
  /** Explicit finish may hand a failed check back for a bounded correction round. */
  allowCorrection?: boolean
}

export type ApplicationClosureOutcome =
  | { outcome: 'continue' }
  | { outcome: 'closed'; result: AgentTaskResult }
