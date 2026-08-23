import { describe, it, expect } from 'vitest'
import { getDefaultAppSettings, sanitizeAppSettings, mergeAppSettings } from './appSettingsDomain'

describe('AppSettingsDomain Unit Tests', () => {
  it('should return valid default settings', () => {
    const defaults = getDefaultAppSettings()
    expect(defaults.defaultModel).toBe('')
    expect(defaults.hardwareProfile).toBe('Auto')
    expect(defaults.ocrEngine).toBe('native_cuda')
    expect(defaults.language).toBe('it')
    expect(defaults.autoInstallHubSkills).toBe('auto')
    expect(defaults.enableSkillRouter).toBe(true)
    expect(defaults.maxToolCallSteps).toBe(50)
  })

  it('should sanitize empty or corrupted input to defaults', () => {
    expect(sanitizeAppSettings(null)).toEqual(getDefaultAppSettings())
    expect(sanitizeAppSettings(undefined)).toEqual(getDefaultAppSettings())
    expect(sanitizeAppSettings('corrupted')).toEqual(getDefaultAppSettings())
  })

  it('should preserve valid custom settings and trim strings', () => {
    const custom = {
      defaultModel: '  qwen2.5-coder:7b  ',
      chatModel: 'llama3.2:3b',
      hardwareProfile: 'HighEnd',
      ocrEngine: 'vision_model',
      ollamaHost: 'http://localhost:11434',
      language: 'en',
      hasCompletedInitialSetup: true,
      customPromptOverrides: { 'coding:master': 'custom prompt' },
    }

    const sanitized = sanitizeAppSettings(custom)
    expect(sanitized.defaultModel).toBe('qwen2.5-coder:7b')
    expect(sanitized.chatModel).toBe('llama3.2:3b')
    expect(sanitized.hardwareProfile).toBe('HighEnd')
    expect(sanitized.ocrEngine).toBe('vision_model')
    expect(sanitized.language).toBe('en')
    expect(sanitized.hasCompletedInitialSetup).toBe(true)
    expect(sanitized.customPromptOverrides).toEqual({ 'coding:master': 'custom prompt' })
  })

  it('drops prompt override keys that do not name a prompt node', () => {
    // Leftovers from the retired per-model-family scheme address prompts that no longer exist;
    // keeping them would silently do nothing while still looking like saved customisation.
    const sanitized = sanitizeAppSettings({
      customPromptOverrides: {
        'coding:qwen': 'legacy family prompt',
        vision: 'legacy module prompt',
        chat: 'still a real node',
        'coding:tools': 'also real',
        'chat:llama': 'legacy',
      },
    })

    expect(sanitized.customPromptOverrides).toEqual({
      chat: 'still a real node',
      'coding:tools': 'also real',
    })
  })

  it('drops non-string prompt override values', () => {
    const sanitized = sanitizeAppSettings({
      customPromptOverrides: { chat: 42 as unknown as string, translation: 'ok' },
    })
    expect(sanitized.customPromptOverrides).toEqual({ translation: 'ok' })
  })

  it('should merge partial updates cleanly onto current settings', () => {
    const current = getDefaultAppSettings()
    const updated = mergeAppSettings(current, {
      codingModel: 'deepseek-r1:8b',
      hasCompletedInitialSetup: true,
    })

    expect(updated.codingModel).toBe('deepseek-r1:8b')
    expect(updated.hasCompletedInitialSetup).toBe(true)
    expect(updated.language).toBe('it')
  })
})
