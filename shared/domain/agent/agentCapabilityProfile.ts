import type { AgentCapabilityProfile, AppSettings } from '../../types'
import { DEFAULT_AGENT_STEP_BUDGET, normalizeAgentStepBudget } from './agentStepBudget'

export const DEFAULT_AGENT_CAPABILITY_PROFILE: AgentCapabilityProfile = {
  allowFileModifications: false,
  allowTerminalExecution: false,
  capabilityPolicyMode: 'offline-strict',
  maxToolCallSteps: DEFAULT_AGENT_STEP_BUDGET,
}

/** Converts settings or an untrusted payload into an Agent Coding profile. */
export function resolveAgentCapabilityProfile(input?: Partial<AppSettings | AgentCapabilityProfile> | null): AgentCapabilityProfile {
  const steps = input?.maxToolCallSteps
  return {
    allowFileModifications: input?.allowFileModifications === true,
    allowTerminalExecution: input?.allowTerminalExecution === true,
    capabilityPolicyMode:
      input?.capabilityPolicyMode === 'local-only' || input?.capabilityPolicyMode === 'network-approved' ? input.capabilityPolicyMode : 'offline-strict',
    maxToolCallSteps: normalizeAgentStepBudget(steps),
  }
}

export function applyAgentCapabilityProfile(settings: AppSettings, profile: AgentCapabilityProfile): AppSettings {
  return { ...settings, ...resolveAgentCapabilityProfile(profile) }
}
