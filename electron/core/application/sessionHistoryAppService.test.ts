import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../infrastructure/filesystem/sessionHistoryRepository', () => ({
  sessionHistoryRepository: {
    listSessions: vi.fn(),
    deleteSession: vi.fn(),
    clearSessions: vi.fn(),
  },
}))
vi.mock('../infrastructure/filesystem/agentSessionStateRepository', () => ({
  agentSessionStateRepository: {
    clearSessionState: vi.fn(),
    clearAllSessionStates: vi.fn(),
  },
}))
vi.mock('../infrastructure/logging/codingAgentLogger', () => ({
  codingAgentLogger: {
    removeSessionFromAuditLog: vi.fn(),
    clearAuditLog: vi.fn(),
  },
}))
vi.mock('./sidecarAppService', () => ({
  sidecarAppService: {
    removePromptHistoryForSessions: vi.fn().mockResolvedValue({ success: true }),
  },
}))
vi.mock('../infrastructure/filesystem/agentCheckpointStore', () => ({
  deleteConversationCheckpoints: vi.fn(),
}))

import { sessionHistoryAppService } from './sessionHistoryAppService'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'
import { sidecarAppService } from './sidecarAppService'
import { deleteConversationCheckpoints } from '../infrastructure/filesystem/agentCheckpointStore'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'

describe('SessionHistoryAppService prompt-history index fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionHistoryRepository.listSessions).mockResolvedValue([])
    vi.mocked(sessionHistoryRepository.deleteSession).mockResolvedValue(true)
    vi.mocked(sessionHistoryRepository.clearSessions).mockResolvedValue(true)
    vi.mocked(agentSessionStateRepository.clearSessionState).mockResolvedValue(true)
    vi.mocked(agentSessionStateRepository.clearAllSessionStates).mockResolvedValue(true)
  })

  it('deleteSession should also remove the deleted session from the prompt-history index', async () => {
    vi.mocked(sessionHistoryRepository.listSessions).mockResolvedValue([
      { id: 'session-1', workspacePath: '/repo/a', executedPrompts: [{ evidence: { checkpointId: 'run-1' } }] },
    ] as never)
    const result = await sessionHistoryAppService.deleteSession('session-1', '/repo/a')

    expect(result).toBe(true)
    expect(sessionHistoryRepository.deleteSession).toHaveBeenCalledWith('session-1', '/repo/a')
    expect(agentSessionStateRepository.clearSessionState).toHaveBeenCalledWith('session-1', '/repo/a')
    expect(deleteConversationCheckpoints).toHaveBeenCalledWith('/repo/a', 'session-1', ['run-1'])
    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenCalledWith(['session-1'])
  })

  it('clearSessions should remove every session id that belonged to the workspace from the prompt-history index', async () => {
    vi.mocked(sessionHistoryRepository.listSessions).mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }] as never)

    const result = await sessionHistoryAppService.clearSessions('/repo/a')

    expect(result).toBe(true)
    expect(sessionHistoryRepository.listSessions).toHaveBeenCalledWith('/repo/a')
    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenCalledWith(['session-1', 'session-2'])
  })

  it('clearSessions should still succeed and call the index removal with an empty list when the workspace has no sessions', async () => {
    vi.mocked(sessionHistoryRepository.listSessions).mockResolvedValue([])

    await sessionHistoryAppService.clearSessions('/repo/empty')

    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenCalledWith([])
  })
})
