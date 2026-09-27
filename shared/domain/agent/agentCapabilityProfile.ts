import type { AgentCapabilityProfile, AppSettings } from '../../types'
import { normalizeAgentStepBudget } from './agentStepBudget'

/** Converts settings or an untrusted payload into an Agent Coding profile. */
export function resolveAgentCapabilityProfile(input?: Partial<AppSettings | AgentCapabilityProfile> | null): AgentCapabilityProfile {
  const steps = input?.maxToolCallSteps
  return {
    allowFileModifications: input?.allowFileModifications !== false,
    allowTerminalExecution: input?.allowTerminalExecution !== false,
    capabilityPolicyMode:
      input?.capabilityPolicyMode === 'local-only' || input?.capabilityPolicyMode === 'offline-strict' ? input.capabilityPolicyMode : 'network-approved',
    maxToolCallSteps: normalizeAgentStepBudget(steps),
  }
}

export function applyAgentCapabilityProfile(settings: AppSettings, profile: AgentCapabilityProfile): AppSettings {
  return { ...settings, ...resolveAgentCapabilityProfile(profile) }
}
