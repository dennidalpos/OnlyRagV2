import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_CAPABILITY_PROFILE, resolveAgentCapabilityProfile } from './agentCapabilityProfile'

describe('Agent capability profile', () => {
  it('uses a finite restrictive profile when settings are absent', () => {
    expect(resolveAgentCapabilityProfile()).toEqual(DEFAULT_AGENT_CAPABILITY_PROFILE)
  })

  it('keeps explicit permissions and bounds the run budget', () => {
    expect(resolveAgentCapabilityProfile({
      allowFileModifications: true,
      allowTerminalExecution: true,
      capabilityPolicyMode: 'network-approved',
      maxToolCallSteps: 1000,
    })).toEqual({
      allowFileModifications: true,
      allowTerminalExecution: true,
      capabilityPolicyMode: 'network-approved',
      maxToolCallSteps: 100,
    })
  })
})
