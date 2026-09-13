import type { AgentCapabilityProfile, AppSettings } from '../../types'

export const DEFAULT_AGENT_CAPABILITY_PROFILE: AgentCapabilityProfile = {
  allowFileModifications: false,
  allowTerminalExecution: false,
  capabilityPolicyMode: 'offline-strict',
  maxToolCallSteps: 25,
}

/** Converts settings or an untrusted payload into a finite Agent Coding profile. */
export function resolveAgentCapabilityProfile(input?: Partial<AppSettings | AgentCapabilityProfile> | null): AgentCapabilityProfile {
  const steps = input?.maxToolCallSteps
  return {
    allowFileModifications: input?.allowFileModifications === true,
    allowTerminalExecution: input?.allowTerminalExecution === true,
    capabilityPolicyMode: input?.capabilityPolicyMode === 'local-only' || input?.capabilityPolicyMode === 'network-approved'
      ? input.capabilityPolicyMode
      : 'offline-strict',
    maxToolCallSteps: typeof steps === 'number' && Number.isFinite(steps)
      ? Math.max(5, Math.min(100, Math.floor(steps)))
      : DEFAULT_AGENT_CAPABILITY_PROFILE.maxToolCallSteps,
  }
}

export function applyAgentCapabilityProfile(settings: AppSettings, profile: AgentCapabilityProfile): AppSettings {
  return { ...settings, ...resolveAgentCapabilityProfile(profile) }
}
