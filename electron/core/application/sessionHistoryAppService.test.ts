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

import { SessionHistoryAppService, sessionHistoryAppService } from './sessionHistoryAppService'
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
    vi.mocked(sidecarAppService.removePromptHistoryForSessions).mockResolvedValue({ success: true })
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

  it('clears standalone history without deleting recovery state owned by unavailable projects', async () => {
    const service = new SessionHistoryAppService()
    vi.mocked(sessionHistoryRepository.listSessions).mockResolvedValue([
      { id: 'standalone', workspacePath: null },
      { id: 'project', workspacePath: '/unavailable' },
    ] as never)
    expect(await service.clearSessions(null)).toBe(true)
    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenCalledWith(['standalone'])
    expect(agentSessionStateRepository.clearSessionState).toHaveBeenCalledTimes(1)
    expect(agentSessionStateRepository.clearSessionState).toHaveBeenCalledWith('standalone', null)
    expect(agentSessionStateRepository.clearAllSessionStates).not.toHaveBeenCalled()
  })

  it('keeps prompt-index batches within the existing 100-session request limit', async () => {
    const service = new SessionHistoryAppService()
    vi.mocked(sessionHistoryRepository.listSessions).mockResolvedValue(Array.from({ length: 205 }, (_, index) => ({ id: `session-${index}` })) as never)
    expect(await service.clearSessions('/repo/a')).toBe(true)
    expect(vi.mocked(sidecarAppService.removePromptHistoryForSessions).mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 5])
  })

  it.each(['state', 'checkpoint'] as const)('retains metadata for retry after rejected %s cleanup', async (failure) => {
    const service = new SessionHistoryAppService()
    vi.mocked(sessionHistoryRepository.listSessions)
      .mockResolvedValueOnce([{ id: 'retained', workspacePath: '/repo/a', executedPrompts: [{ evidence: { checkpointId: 'legacy-run' } }] }] as never)
      .mockResolvedValue([])
    vi.mocked(sessionHistoryRepository.deleteSession).mockResolvedValueOnce(true).mockResolvedValue(false)
    if (failure === 'state') {
      vi.mocked(agentSessionStateRepository.clearSessionState).mockResolvedValueOnce(false)
      expect(await service.deleteSession('retained', '/repo/a')).toBe(false)
      expect(deleteConversationCheckpoints).not.toHaveBeenCalled()
    } else {
      vi.mocked(deleteConversationCheckpoints).mockImplementationOnce(() => {
        throw new Error('Checkpoint locked')
      })
      await expect(service.deleteSession('retained', '/repo/a')).rejects.toThrow('Checkpoint locked')
    }
    expect(await service.deleteSession('retained', '/repo/a')).toBe(true)
    expect(deleteConversationCheckpoints).toHaveBeenLastCalledWith('/repo/a', 'retained', ['legacy-run'])
  })

  it.each(['delete', 'clear'] as const)('preserves recovery assets when history %s is refused', async (operation) => {
    const service = new SessionHistoryAppService()
    vi.mocked(sessionHistoryRepository.listSessions).mockResolvedValue([{ id: 'retained', workspacePath: '/repo/a' }] as never)
    vi.mocked(sessionHistoryRepository.deleteSession).mockResolvedValue(false)
    vi.mocked(sessionHistoryRepository.clearSessions).mockResolvedValue(false)
    expect(await (operation === 'delete' ? service.deleteSession('retained', '/repo/a') : service.clearSessions('/repo/a'))).toBe(false)
    expect(deleteConversationCheckpoints).not.toHaveBeenCalled()
    expect(agentSessionStateRepository.clearSessionState).not.toHaveBeenCalled()
    expect(agentSessionStateRepository.clearAllSessionStates).not.toHaveBeenCalled()
    expect(sidecarAppService.removePromptHistoryForSessions).not.toHaveBeenCalled()
  })

  it.each(['delete', 'clear'] as const)('reports partial index cleanup and retains checkpoint references for an explicit %s retry', async (operation) => {
    const service = new SessionHistoryAppService()
    vi.mocked(sessionHistoryRepository.listSessions)
      .mockResolvedValueOnce([{ id: 'retained', workspacePath: '/repo/a', executedPrompts: [{ evidence: { checkpointId: 'legacy-run' } }] }] as never)
      .mockResolvedValue([])
    vi.mocked(sidecarAppService.removePromptHistoryForSessions).mockResolvedValueOnce({ success: false }).mockResolvedValue({ success: true })
    expect(await (operation === 'delete' ? service.deleteSession('retained', '/repo/a') : service.clearSessions('/repo/a'))).toBe(false)
    expect(deleteConversationCheckpoints).not.toHaveBeenCalled()
    expect(await (operation === 'delete' ? service.deleteSession('retained', '/repo/a') : service.clearSessions('/repo/a'))).toBe(true)
    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenLastCalledWith(['retained'])
    expect(deleteConversationCheckpoints).toHaveBeenCalledWith('/repo/a', 'retained', ['legacy-run'])
  })
})
