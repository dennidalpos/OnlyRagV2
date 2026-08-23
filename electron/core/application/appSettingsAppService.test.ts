import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AppSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { AppSettingsAppService } from './appSettingsAppService'
import { getDefaultAppSettings } from '../domain/settings/appSettingsDomain'

describe('AppSettingsAppService Unit Tests', () => {
  let tmpDir: string
  let service: AppSettingsAppService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-settings-svc-test-'))
    const repo = new AppSettingsRepository(tmpDir)
    service = new AppSettingsAppService(repo)
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('should return null when no settings are persisted', async () => {
    const res = await service.getSettings()
    expect(res).toBeNull()
  })

  it('should save and retrieve settings through the service', async () => {
    const sample = {
      ...getDefaultAppSettings(),
      codingModel: 'qwen2.5-coder:7b',
      allowTerminalExecution: true,
    }

    const saved = await service.saveSettings(sample)
    expect(saved).toBe(true)

    const retrieved = await service.getSettings()
    expect(retrieved?.codingModel).toBe('qwen2.5-coder:7b')
    expect(retrieved?.allowTerminalExecution).toBe(true)
  })
})
