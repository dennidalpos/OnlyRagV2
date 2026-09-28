import { describe, expect, it } from 'vitest'
import { agentTaskRequestSchema } from './agentTaskContract'

describe('agentTaskRequestSchema capability profiles', () => {
  const request = {
    identity: { runId: 'run-1', conversationId: 'chat-1', planRevisionId: 'plan-1', workspaceId: 'workspace-1' },
    userTask: 'Inspect the project',
    capabilityProfile: {
      allowFileModifications: true,
      allowTerminalExecution: true,
      capabilityPolicyMode: 'network-approved',
      maxToolCallSteps: 25,
    },
  }

  it('accepts a saved profile without Full access', () => {
    expect(agentTaskRequestSchema.safeParse(request).success).toBe(true)
  })

  it('accepts an explicit Full access snapshot', () => {
    const parsed = agentTaskRequestSchema.parse({ ...request, capabilityProfile: { ...request.capabilityProfile, fullAccess: true } })
    expect(parsed.capabilityProfile?.fullAccess).toBe(true)
  })
})
