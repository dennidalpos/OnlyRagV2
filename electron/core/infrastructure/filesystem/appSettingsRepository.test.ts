import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AppSettingsRepository } from './appSettingsRepository'
import { getDefaultAppSettings } from '../../domain/settings/appSettingsDomain'

describe('AppSettingsRepository Unit Tests', () => {
  let tmpDir: string
  let repo: AppSettingsRepository

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-settings-test-'))
    repo = new AppSettingsRepository(tmpDir)
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('should return null when settings.json does not exist', async () => {
    const res = await repo.loadSettings()
    expect(res).toBeNull()
  })

  it('should save settings atomically and load them accurately', async () => {
    const sample = {
      ...getDefaultAppSettings(),
      defaultModel: 'qwen2.5-coder:7b',
      chatModel: 'llama3.2:3b',
      hasCompletedInitialSetup: true,
      capabilityPolicyMode: 'offline-strict' as const,
    }

    const saved = await repo.saveSettings(sample)
    expect(saved).toBe(true)

    const loaded = await repo.loadSettings()
    expect(loaded).not.toBeNull()
    expect(loaded?.defaultModel).toBe('qwen2.5-coder:7b')
    expect(loaded?.chatModel).toBe('llama3.2:3b')
    expect(loaded?.hasCompletedInitialSetup).toBe(true)
    expect(loaded?.capabilityPolicyMode).toBe('offline-strict')
  })

  it('should recover gracefully from corrupted settings.json', async () => {
    const target = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(target, '{ invalid json syntax ...', 'utf-8')

    const loaded = await repo.loadSettings()
    expect(loaded).toBeNull()
  })
})
