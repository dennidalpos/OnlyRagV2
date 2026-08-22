import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../infrastructure/filesystem/projectRegistryRepository', () => ({
  projectRegistryRepository: {
    remove: vi.fn(),
  },
}))
vi.mock('./sessionHistoryAppService', () => ({
  sessionHistoryAppService: {
    clearSessions: vi.fn().mockResolvedValue(true),
  },
}))
vi.mock('./sidecarAppService', () => ({
  sidecarAppService: {
    removePromptHistoryForProject: vi.fn().mockResolvedValue({ success: true }),
  },
}))

import { projectRegistryAppService } from './projectRegistryAppService'
import { projectRegistryRepository } from '../infrastructure/filesystem/projectRegistryRepository'
import { sessionHistoryAppService } from './sessionHistoryAppService'
import { sidecarAppService } from './sidecarAppService'

describe('ProjectRegistryAppService project removal and purge fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removeProject should clear sessions, purge prompt history, and unregister project', async () => {
    ;(projectRegistryRepository.remove as any).mockResolvedValue(true)

    const result = await projectRegistryAppService.removeProject('/repo/a')

    expect(result).toBe(true)
    expect(sessionHistoryAppService.clearSessions).toHaveBeenCalledWith('/repo/a')
    expect(sidecarAppService.removePromptHistoryForProject).toHaveBeenCalledWith('/repo/a')
    expect(projectRegistryRepository.remove).toHaveBeenCalledWith('/repo/a')
  })

  it('removeProject should still fan out even if the project was already unregistered', async () => {
    ;(projectRegistryRepository.remove as any).mockResolvedValue(false)

    const result = await projectRegistryAppService.removeProject('/repo/never-existed')

    expect(result).toBe(false)
    expect(sessionHistoryAppService.clearSessions).toHaveBeenCalledWith('/repo/never-existed')
    expect(sidecarAppService.removePromptHistoryForProject).toHaveBeenCalledWith('/repo/never-existed')
  })
})
