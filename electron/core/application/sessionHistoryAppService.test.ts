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

import { sessionHistoryAppService } from './sessionHistoryAppService'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'
import { sidecarAppService } from './sidecarAppService'

describe('SessionHistoryAppService prompt-history index fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(sessionHistoryRepository.deleteSession as any).mockResolvedValue(true)
    ;(sessionHistoryRepository.clearSessions as any).mockResolvedValue(true)
  })

  it('deleteSession should also remove the deleted session from the prompt-history index', async () => {
    const result = await sessionHistoryAppService.deleteSession('session-1', '/repo/a')

    expect(result).toBe(true)
    expect(sessionHistoryRepository.deleteSession).toHaveBeenCalledWith('session-1', '/repo/a')
    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenCalledWith(['session-1'])
  })

  it('clearSessions should remove every session id that belonged to the workspace from the prompt-history index', async () => {
    ;(sessionHistoryRepository.listSessions as any).mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }])

    const result = await sessionHistoryAppService.clearSessions('/repo/a')

    expect(result).toBe(true)
    expect(sessionHistoryRepository.listSessions).toHaveBeenCalledWith('/repo/a')
    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenCalledWith(['session-1', 'session-2'])
  })

  it('clearSessions should still succeed and call the index removal with an empty list when the workspace has no sessions', async () => {
    ;(sessionHistoryRepository.listSessions as any).mockResolvedValue([])

    await sessionHistoryAppService.clearSessions('/repo/empty')

    expect(sidecarAppService.removePromptHistoryForSessions).toHaveBeenCalledWith([])
  })
})
