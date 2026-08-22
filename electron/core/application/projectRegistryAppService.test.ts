import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

  it('removeProject should safely purge internal .onlyrag metadata without deleting user workspace folder', async () => {
    ;(projectRegistryRepository.remove as any).mockResolvedValue(true)

    // Create a real temp workspace with user file and .onlyrag metadata folder
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-proj-test-'))
    const userFile = path.join(tempDir, 'App.tsx')
    const onlyragDir = path.join(tempDir, '.onlyrag')
    const sessionFile = path.join(onlyragDir, 'sessions.json')

    fs.writeFileSync(userFile, 'export default function App() {}', 'utf-8')
    fs.mkdirSync(onlyragDir, { recursive: true })
    fs.writeFileSync(sessionFile, '{}', 'utf-8')

    expect(fs.existsSync(userFile)).toBe(true)
    expect(fs.existsSync(onlyragDir)).toBe(true)

    await projectRegistryAppService.removeProject(tempDir)

    // Verify .onlyrag was purged, but user project and source files are 100% intact!
    expect(fs.existsSync(onlyragDir)).toBe(false)
    expect(fs.existsSync(userFile)).toBe(true)
    expect(fs.existsSync(tempDir)).toBe(true)

    // Cleanup tempDir
    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
