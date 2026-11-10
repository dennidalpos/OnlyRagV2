import type { AgentRunIdentity } from '../../types'

export interface AgentRunIdentityInput {
  runId?: string
  conversationId: string
  planRevisionId?: string
  workspaceId?: string
  workspacePath?: string | null
}

function opaqueId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}:${uuid || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`
}

export function createAgentRunIdentity(input: AgentRunIdentityInput): Readonly<AgentRunIdentity> {
  const conversationId = input.conversationId.trim()
  if (!conversationId) throw new Error('Agent run conversationId is required')

  const runId = input.runId?.trim() || opaqueId('run')
  const planRevisionId = input.planRevisionId?.trim() || opaqueId('unplanned')
  const workspaceId = input.workspaceId?.trim() || (input.workspacePath?.trim() ? `workspace:${input.workspacePath.trim()}` : `standalone:${conversationId}`)

  return Object.freeze({ runId, conversationId, planRevisionId, workspaceId })
}

export function matchesAgentRunIdentity(expected: AgentRunIdentity | null | undefined, candidate: Partial<AgentRunIdentity> | null | undefined): boolean {
  return Boolean(
    expected &&
      candidate &&
      expected.runId === candidate.runId &&
      expected.conversationId === candidate.conversationId &&
      expected.planRevisionId === candidate.planRevisionId &&
      expected.workspaceId === candidate.workspaceId,
  )
}
