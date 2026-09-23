import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_CAPABILITY_PROFILE, resolveAgentCapabilityProfile } from './agentCapabilityProfile'

describe('Agent capability profile', () => {
  it('uses a finite restrictive profile when settings are absent', () => {
    expect(resolveAgentCapabilityProfile()).toEqual(DEFAULT_AGENT_CAPABILITY_PROFILE)
  })

  it('keeps explicit permissions and bounds the run budget', () => {
    expect(
      resolveAgentCapabilityProfile({
        allowFileModifications: true,
        allowTerminalExecution: true,
        capabilityPolicyMode: 'network-approved',
        maxToolCallSteps: 1000,
      }),
    ).toEqual({
      allowFileModifications: true,
      allowTerminalExecution: true,
      capabilityPolicyMode: 'network-approved',
      maxToolCallSteps: 200,
    })
  })

  it('preserves the unlimited sentinel and finite upper limit', () => {
    expect(resolveAgentCapabilityProfile({ maxToolCallSteps: 0 }).maxToolCallSteps).toBe(0)
    expect(resolveAgentCapabilityProfile({ maxToolCallSteps: 10 }).maxToolCallSteps).toBe(10)
    expect(resolveAgentCapabilityProfile({ maxToolCallSteps: 100 }).maxToolCallSteps).toBe(100)
    expect(resolveAgentCapabilityProfile({ maxToolCallSteps: 200 }).maxToolCallSteps).toBe(200)
  })
})
