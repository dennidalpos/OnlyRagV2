import { describe, it, expect } from 'vitest'
import { getDefaultAppSettings, sanitizeAppSettings, mergeAppSettings } from './appSettingsDomain'

describe('AppSettingsDomain Unit Tests', () => {
  it('should return valid default settings', () => {
    const defaults = getDefaultAppSettings()
    expect(defaults.defaultModel).toBe('')
    expect(defaults.ocrEngine).toBe('native_cuda')
    expect(defaults.language).toBe('it')
    expect(defaults.autoInstallHubSkills).toBe('disabled')
    expect(defaults.enableSkillRouter).toBe(false)
    expect(defaults.maxToolCallSteps).toBe(0)
  })

  it('should sanitize empty or corrupted input to defaults', () => {
    expect(sanitizeAppSettings(null)).toEqual(getDefaultAppSettings())
    expect(sanitizeAppSettings(undefined)).toEqual(getDefaultAppSettings())
    expect(sanitizeAppSettings('corrupted')).toEqual(getDefaultAppSettings())
  })

  it('preserves a valid capability policy mode and drops invalid values', () => {
    expect(sanitizeAppSettings({ capabilityPolicyMode: 'offline-strict' }).capabilityPolicyMode).toBe('offline-strict')
    expect(sanitizeAppSettings({ capabilityPolicyMode: 'auto' }).capabilityPolicyMode).toBeUndefined()
  })

  it('retires the legacy automatic skill-install mode to disabled', () => {
    expect(sanitizeAppSettings({ autoInstallHubSkills: 'auto' }).autoInstallHubSkills).toBe('disabled')
  })

  it('should preserve valid custom settings and trim strings', () => {
    const custom = {
      defaultModel: '  qwen2.5-coder:7b  ',
      chatModel: 'llama3.2:3b',
      ocrEngine: 'vision_model',
      ollamaHost: 'http://localhost:11434',
      language: 'en',
      hasCompletedInitialSetup: true,
      customPromptOverrides: { 'coding:master': 'custom prompt' },
    }

    const sanitized = sanitizeAppSettings(custom)
    expect(sanitized.defaultModel).toBe('qwen2.5-coder:7b')
    expect(sanitized.chatModel).toBe('llama3.2:3b')
    expect(sanitized.ocrEngine).toBe('vision_model')
    expect(sanitized.language).toBe('en')
    expect(sanitized.hasCompletedInitialSetup).toBe(true)
    expect(sanitized.customPromptOverrides).toEqual({ 'coding:master': 'custom prompt' })
  })

  it('should preserve maxToolCallSteps: 0 for unlimited execution and valid numeric ranges', () => {
    const unlimited = sanitizeAppSettings({ maxToolCallSteps: 0 })
    expect(unlimited.maxToolCallSteps).toBe(0)

    const customSteps = sanitizeAppSettings({ maxToolCallSteps: 120 })
    expect(customSteps.maxToolCallSteps).toBe(120)

    const invalidNegative = sanitizeAppSettings({ maxToolCallSteps: -5 })
    expect(invalidNegative.maxToolCallSteps).toBe(0)

    const invalidTooHigh = sanitizeAppSettings({ maxToolCallSteps: 9999 })
    expect(invalidTooHigh.maxToolCallSteps).toBe(0)
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
      maxToolCallSteps: 0,
    })

    expect(updated.codingModel).toBe('deepseek-r1:8b')
    expect(updated.hasCompletedInitialSetup).toBe(true)
    expect(updated.language).toBe('it')
    expect(updated.maxToolCallSteps).toBe(0)
  })

  it('sanitizes per-model context preferences with a 4096-token floor', () => {
    const sanitized = sanitizeAppSettings({
      modelContextLengths: {
        ' qwen2.5-coder:7b ': 8192.9,
        tooSmall: 2048,
        invalid: Number.NaN,
      },
    })
    expect(sanitized.modelContextLengths).toEqual({ 'qwen2.5-coder:7b': 8192 })
  })

  it('preserves verifyBeforeFinish, enablePrePlanInterview and bounds-checks agentSessionTimeoutMinutes', () => {
    const valid = sanitizeAppSettings({
      verifyBeforeFinish: false,
      enablePrePlanInterview: false,
      agentSessionTimeoutMinutes: 60,
    })
    expect(valid.verifyBeforeFinish).toBe(false)
    expect(valid.enablePrePlanInterview).toBe(false)
    expect(valid.agentSessionTimeoutMinutes).toBe(60)

    const invalidTimeout = sanitizeAppSettings({
      agentSessionTimeoutMinutes: 2, // below min 5
    })
    expect(invalidTimeout.agentSessionTimeoutMinutes).toBeUndefined()

    const tooHighTimeout = sanitizeAppSettings({
      agentSessionTimeoutMinutes: 300, // above max 240
    })
    expect(tooHighTimeout.agentSessionTimeoutMinutes).toBeUndefined()

    const floatTimeout = sanitizeAppSettings({
      agentSessionTimeoutMinutes: 45.8,
    })
    expect(floatTimeout.agentSessionTimeoutMinutes).toBe(45)
  })
})
