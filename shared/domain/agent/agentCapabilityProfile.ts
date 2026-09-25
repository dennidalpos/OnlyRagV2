import type { AgentCapabilityProfile, AppSettings } from '../../types'
import { normalizeAgentStepBudget } from './agentStepBudget'

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
