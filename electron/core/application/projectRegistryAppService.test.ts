import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../infrastructure/filesystem/projectRegistryRepository', () => ({
  projectRegistryRepository: {
    remove: vi.fn(),
  },
}))
vi.mock('./sidecarAppService', () => ({
  sidecarAppService: {
    removePromptHistoryForProject: vi.fn().mockResolvedValue({ success: true }),
  },
}))

import { projectRegistryAppService } from './projectRegistryAppService'
import { projectRegistryRepository } from '../infrastructure/filesystem/projectRegistryRepository'
import { sidecarAppService } from './sidecarAppService'

describe('ProjectRegistryAppService prompt-history index fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removeProject should also remove the project from the prompt-history index', async () => {
    ;(projectRegistryRepository.remove as any).mockResolvedValue(true)

    const result = await projectRegistryAppService.removeProject('/repo/a')

    expect(result).toBe(true)
    expect(projectRegistryRepository.remove).toHaveBeenCalledWith('/repo/a')
    expect(sidecarAppService.removePromptHistoryForProject).toHaveBeenCalledWith('/repo/a')
  })

  it('removeProject should still fan out to the index even if the project was already unregistered', async () => {
    ;(projectRegistryRepository.remove as any).mockResolvedValue(false)

    const result = await projectRegistryAppService.removeProject('/repo/never-existed')

    expect(result).toBe(false)
    expect(sidecarAppService.removePromptHistoryForProject).toHaveBeenCalledWith('/repo/never-existed')
  })
})
