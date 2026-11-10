import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { workspaceAppService } from './workspaceAppService'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { webClient } from '../infrastructure/http/webClient'
import { contentVersion } from '../infrastructure/filesystem/fileContentVersion'

describe('WorkspaceAppService File Deletion & Reference Purge Unit Tests', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-delete-test-'))
    vi.spyOn(appSettingsRepository, 'loadSettingsOrThrow').mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('blocks non-agent web access when offline-strict is enabled', async () => {
    vi.mocked(appSettingsRepository.loadSettingsOrThrow).mockResolvedValue({ capabilityPolicyMode: 'offline-strict' } as never)
    const search = vi.spyOn(webClient, 'searchWeb')

    const result = await workspaceAppService.searchWeb('blocked query')

    expect(result).toMatchObject({ success: false, error: 'Network egress is disabled in offline-strict mode' })
    expect(search).not.toHaveBeenCalled()
  })

  it('allows loopback fetches but blocks external fetches in local-only mode', async () => {
    vi.mocked(appSettingsRepository.loadSettingsOrThrow).mockResolvedValue({ capabilityPolicyMode: 'local-only' } as never)
    const fetchContent = vi.spyOn(webClient, 'fetchWebContent').mockResolvedValue({ success: true, content: 'local' })

    const localResult = await workspaceAppService.fetchWebContent('http://127.0.0.1:11434/api')
    const externalResult = await workspaceAppService.fetchWebContent('https://example.test')

    expect(localResult).toMatchObject({ success: true })
    expect(externalResult).toMatchObject({ success: false, error: 'Only loopback network targets are allowed in local-only mode' })
    expect(fetchContent).toHaveBeenCalledTimes(1)
  })

  it('fails closed with zero external adapter calls when the stored policy cannot be read, and recovers afterwards', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-policy-read-'))
    const settingsFile = path.join(stateDir, 'settings.json')
    const store = new (await import('../infrastructure/filesystem/appSettingsRepository')).AppSettingsRepository(stateDir)
    const search = vi.spyOn(webClient, 'searchWeb').mockResolvedValue({ success: true, results: [] } as never)
    const fetchContent = vi.spyOn(webClient, 'fetchWebContent').mockResolvedValue({ success: true, content: 'x' })
    const download = vi.spyOn(webClient, 'downloadFile').mockResolvedValue({ success: true } as never)
    vi.mocked(appSettingsRepository.loadSettingsOrThrow).mockImplementation(() => store.loadSettingsOrThrow())
    await store.saveSettings({ capabilityPolicyMode: 'offline-strict' } as never)
    const valid = fs.readFileSync(settingsFile, 'utf-8')
    try {
      const failures: Array<[string, () => void]> = [
        ['invalid JSON', () => fs.writeFileSync(settingsFile, '{not json')],
        ['unsupported version', () => fs.writeFileSync(settingsFile, JSON.stringify({ version: 9999, settings: {} }))],
        [
          'EACCES',
          () => {
            fs.writeFileSync(settingsFile, valid)
            const real = fs.promises.readFile
            vi.spyOn(fs.promises, 'readFile').mockImplementation(((target: unknown, ...rest: unknown[]) =>
              String(target) === settingsFile
                ? Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
                : (real as (...a: unknown[]) => unknown)(target, ...rest)) as never)
          },
        ],
      ]
      for (const [label, inject] of failures) {
        inject()
        const results = [
          await workspaceAppService.searchWeb('q'),
          await workspaceAppService.fetchWebContent('https://example.test'),
          await workspaceAppService.downloadFile('https://example.test/f', path.join(stateDir, 'f')),
        ]
        for (const result of results) expect(result, label).toMatchObject({ success: false, error: expect.stringContaining('settings are unreadable') })
        vi.restoreAllMocks()
        vi.spyOn(webClient, 'searchWeb').mockImplementation(search.getMockImplementation() as never)
        vi.spyOn(webClient, 'fetchWebContent').mockImplementation(fetchContent.getMockImplementation() as never)
        vi.spyOn(webClient, 'downloadFile').mockImplementation(download.getMockImplementation() as never)
        vi.spyOn(appSettingsRepository, 'loadSettingsOrThrow').mockImplementation(() => store.loadSettingsOrThrow())
      }
      expect(search).not.toHaveBeenCalled()
      expect(fetchContent).not.toHaveBeenCalled()
      expect(download).not.toHaveBeenCalled()

      // Recovery: a readable file applies the stored restriction with its normal message.
      fs.writeFileSync(settingsFile, valid)
      expect(await workspaceAppService.fetchWebContent('https://example.test')).toMatchObject({ error: 'Network egress is disabled in offline-strict mode' })
      // A genuinely missing file keeps the documented first-launch behaviour (no restriction).
      fs.rmSync(settingsFile)
      expect(await workspaceAppService.fetchWebContent('https://example.test')).toMatchObject({ success: true })
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true })
    }
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

  it('rejects a stale editor save and permits an explicit compare-and-swap overwrite', async () => {
    const filePath = path.join(tmpDir, 'editor.txt')
    fs.writeFileSync(filePath, 'loaded', 'utf-8')
    const loadedHash = contentVersion('loaded')
    fs.writeFileSync(filePath, 'agent change', 'utf-8')

    const conflict = workspaceAppService.writeFile(filePath, 'editor change', loadedHash)
    expect(conflict).toMatchObject({
      success: false,
      conflict: true,
      currentContent: 'agent change',
      currentContentHash: contentVersion('agent change'),
    })
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('agent change')

    const overwrite = workspaceAppService.writeFile(filePath, 'editor change', conflict.currentContentHash)
    expect(overwrite).toMatchObject({ success: true, contentHash: contentVersion('editor change') })
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('editor change')
  })

  it('rejects editor writes through a junction outside the selected workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-editor-outside-'))
    try {
      const link = path.join(tmpDir, 'escape')
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')

      const result = workspaceAppService.writeFile(path.join(link, 'leak.txt'), 'blocked', undefined, tmpDir)

      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Symlink or junction escape blocked') })
      expect(fs.existsSync(path.join(outside, 'leak.txt'))).toBe(false)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
})
