import { describe, expect, it } from 'vitest'
import { createAgentRunIdentity, matchesAgentRunIdentity } from './agentRunIdentity'

describe('agentRunIdentity', () => {
  it('creates an immutable identity for one conversation and workspace snapshot', () => {
    const identity = createAgentRunIdentity({
      runId: 'run-1',
      conversationId: 'conversation-1',
      planRevisionId: 'plan-1:v2',
      workspacePath: 'D:\\Work Folder',
    })

    expect(identity).toEqual({
      runId: 'run-1',
      conversationId: 'conversation-1',
      planRevisionId: 'plan-1:v2',
      workspaceId: 'workspace:D:\\Work Folder',
    })
    expect(Object.isFrozen(identity)).toBe(true)
  })

  it('rejects events from another run or plan revision', () => {
    const identity = createAgentRunIdentity({
      runId: 'run-1',
      conversationId: 'conversation-1',
      planRevisionId: 'plan-1:v2',
      workspaceId: 'workspace-1',
    })

    expect(matchesAgentRunIdentity(identity, identity)).toBe(true)
    expect(matchesAgentRunIdentity(identity, { ...identity, runId: 'run-2' })).toBe(false)
    expect(matchesAgentRunIdentity(identity, { ...identity, planRevisionId: 'plan-1:v3' })).toBe(false)
  })
})
