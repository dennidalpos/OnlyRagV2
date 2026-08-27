import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { workspaceAppService } from './workspaceAppService'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { webClient } from '../infrastructure/http/webClient'

describe('WorkspaceAppService File Deletion & Reference Purge Unit Tests', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-delete-test-'))
    vi.spyOn(appSettingsRepository, 'loadSettings').mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('blocks non-agent web access when offline-strict is enabled', async () => {
    vi.mocked(appSettingsRepository.loadSettings).mockResolvedValue({ capabilityPolicyMode: 'offline-strict' } as any)
    const search = vi.spyOn(webClient, 'searchWeb')

    const result = await workspaceAppService.searchWeb('blocked query')

    expect(result).toMatchObject({ success: false, error: 'Network egress is disabled in offline-strict mode' })
    expect(search).not.toHaveBeenCalled()
  })

  it('allows loopback fetches but blocks external fetches in local-only mode', async () => {
    vi.mocked(appSettingsRepository.loadSettings).mockResolvedValue({ capabilityPolicyMode: 'local-only' } as any)
    const fetchContent = vi.spyOn(webClient, 'fetchWebContent').mockResolvedValue({ success: true, content: 'local' })

    const localResult = await workspaceAppService.fetchWebContent('http://127.0.0.1:11434/api')
    const externalResult = await workspaceAppService.fetchWebContent('https://example.test')

    expect(localResult).toMatchObject({ success: true })
    expect(externalResult).toMatchObject({ success: false, error: 'Only loopback network targets are allowed in local-only mode' })
    expect(fetchContent).toHaveBeenCalledTimes(1)
  })

  it('should successfully delete a single file on disk and return success', async () => {
    const filePath = path.join(tmpDir, 'test-file.txt')
    fs.writeFileSync(filePath, 'hello world', 'utf-8')
    expect(fs.existsSync(filePath)).toBe(true)

    const res = await workspaceAppService.deleteFile(filePath)
    expect(res.success).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('should recursively delete a directory on disk', async () => {
    const subDir = path.join(tmpDir, 'subfolder')
    const childFile = path.join(subDir, 'child.txt')
    fs.mkdirSync(subDir, { recursive: true })
    fs.writeFileSync(childFile, 'child content', 'utf-8')

    expect(fs.existsSync(childFile)).toBe(true)
    const res = await workspaceAppService.deleteFile(subDir)
    expect(res.success).toBe(true)
    expect(fs.existsSync(subDir)).toBe(false)
  })

  it('should return failure if trying to delete a non-existent file', async () => {
    const missingPath = path.join(tmpDir, 'non-existent.txt')
    const res = await workspaceAppService.deleteFile(missingPath)
    expect(res.success).toBe(false)
    expect(res.error).toBe('File does not exist')
  })
})
