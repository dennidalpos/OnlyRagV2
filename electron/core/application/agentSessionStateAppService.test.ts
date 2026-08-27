import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../infrastructure/filesystem/agentSessionStateRepository', () => ({
  agentSessionStateRepository: {
    loadSessionState: vi.fn(),
    seedPlanMilestones: vi.fn(),
  },
}))

import { agentSessionStateAppService } from './agentSessionStateAppService'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'

describe('AgentSessionStateAppService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads runtime state through the repository boundary', async () => {
    const state = { sessionId: 'session-1' }
    vi.mocked(agentSessionStateRepository.loadSessionState).mockResolvedValue(state as never)

    await expect(agentSessionStateAppService.loadSessionState('session-1', '/repo')).resolves.toBe(state)
    expect(agentSessionStateRepository.loadSessionState).toHaveBeenCalledWith('session-1', '/repo')
  })

  it('seeds plan milestones through the repository boundary', async () => {
    const milestones = [{ id: 'm-1', title: 'Create app', status: 'pending' as const }]
    vi.mocked(agentSessionStateRepository.seedPlanMilestones).mockResolvedValue(true)

    await agentSessionStateAppService.seedPlanMilestones('session-1', '/repo', milestones, 'Create app')
    expect(agentSessionStateRepository.seedPlanMilestones).toHaveBeenCalledWith('session-1', '/repo', milestones, 'Create app')
  })
})
