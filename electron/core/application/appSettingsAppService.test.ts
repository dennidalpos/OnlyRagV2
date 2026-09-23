import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    service = new AppSettingsAppService(repo, { getLaunchedOllamaHost: () => null, restartPythonSidecar: async () => true })
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

  it('restarts a running sidecar once the edited Ollama host settles, and only if it changed', async () => {
    const sidecar = { getLaunchedOllamaHost: () => 'http://127.0.0.1:11434', restartPythonSidecar: vi.fn(async () => true) }
    const withSidecar = new AppSettingsAppService(new AppSettingsRepository(tmpDir), sidecar, 20)
    const settle = () => new Promise((resolve) => setTimeout(resolve, 40))

    await withSidecar.saveSettings({ ...getDefaultAppSettings(), ollamaHost: '127.0.0.1:11434/' })
    await settle()
    expect(sidecar.restartPythonSidecar).not.toHaveBeenCalled()

    // Keystroke-by-keystroke saves collapse into a single restart.
    for (const host of ['http://192.168.1.2', 'http://192.168.1.20', 'http://192.168.1.20:11434']) {
      await withSidecar.saveSettings({ ...getDefaultAppSettings(), ollamaHost: host })
    }
    await settle()
    expect(sidecar.restartPythonSidecar).toHaveBeenCalledTimes(1)
  })

  it('does not start a sidecar this session never launched', async () => {
    const sidecar = { getLaunchedOllamaHost: () => null, restartPythonSidecar: vi.fn(async () => true) }
    await new AppSettingsAppService(new AppSettingsRepository(tmpDir), sidecar, 0).saveSettings({
      ...getDefaultAppSettings(),
      ollamaHost: 'http://192.168.1.20:11434',
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sidecar.restartPythonSidecar).not.toHaveBeenCalled()
  })
})
