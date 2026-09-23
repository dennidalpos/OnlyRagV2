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

  it('falls back to null for Main readers but rejects strict reads of a corrupted settings.json', async () => {
    const target = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(target, '{ invalid json syntax ...', 'utf-8')

    await expect(repo.loadSettings()).resolves.toBeNull()
    await expect(repo.loadSettingsOrThrow()).rejects.toThrow('Settings file is unreadable')
    expect(fs.readFileSync(target, 'utf-8')).toBe('{ invalid json syntax ...')
  })

  it('rejects strict reads of an unsupported settings version without rewriting it', async () => {
    const target = path.join(tmpDir, 'settings.json')
    const content = JSON.stringify({ version: 99, settings: { defaultModel: 'future' } })
    fs.writeFileSync(target, content, 'utf-8')

    await expect(repo.loadSettingsOrThrow()).rejects.toThrow('Unsupported settings version')
    expect(fs.readFileSync(target, 'utf-8')).toBe(content)
  })

  it('migrates flat legacy budgets while preserving finite 200 in the versioned format', async () => {
    const target = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(target, JSON.stringify({ maxToolCallSteps: 200 }), 'utf-8')
    expect((await repo.loadSettings())?.maxToolCallSteps).toBe(0)
    expect(JSON.parse(fs.readFileSync(target, 'utf-8')).version).toBe(2)

    await repo.saveSettings({ ...getDefaultAppSettings(), maxToolCallSteps: 200 })
    expect((await repo.loadSettings())?.maxToolCallSteps).toBe(200)
  })
})
