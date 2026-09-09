import { describe, expect, it } from 'vitest'
import { enrichOllamaGenerationTelemetry, validateRestoredOllamaRuntime, type OllamaSessionRuntimeProfile } from './ollamaSessionRuntime'
import { HardwareProfileResolver } from './hardwareProfileResolver'

const profile: OllamaSessionRuntimeProfile = {
  model: 'qwen2.5-coder:7b',
  host: 'http://127.0.0.1:11434',
  digest: 'sha256:a',
  options: HardwareProfileResolver.resolveOllamaOptions('Low', { cpuCount: 4, systemRamGB: 8 }),
}

describe('restored Ollama runtime validation', () => {
  it('accepts the exact endpoint, model tag, and digest', () => {
    expect(validateRestoredOllamaRuntime(
      profile,
      '127.0.0.1:11434/',
      [profile.model],
      { [profile.model]: { capabilities: [], digest: profile.digest } }
    )).toBeNull()
  })

  it('rejects endpoint, model, or digest drift', () => {
    expect(validateRestoredOllamaRuntime(profile, 'http://localhost:11434', [profile.model], {})).toContain('host changed')
    expect(validateRestoredOllamaRuntime(profile, profile.host, [], {})).toContain('no longer installed')
    expect(validateRestoredOllamaRuntime(profile, profile.host, [profile.model], {
      [profile.model]: { capabilities: [], digest: 'sha256:b' },
    })).toContain('changed digest')
  })

  it('rejects malformed persisted options', () => {
    expect(validateRestoredOllamaRuntime(
      { ...profile, options: { ...profile.options, num_ctx: 0 } },
      profile.host,
      [profile.model],
      { [profile.model]: { capabilities: [], digest: profile.digest } }
    )).toContain('profile is invalid')
  })

  it('derives the CPU allocation from the live /api/ps model', () => {
    const metric = enrichOllamaGenerationTelemetry({
      model: profile.model,
      numCtx: 4096,
      startedAt: '2026-09-08T00:00:00.000Z',
      wallDurationMs: 250,
    }, 3, {
      name: profile.model,
      model: profile.model,
      size: 10_000,
      size_vram: 7_500,
      context_length: 4096,
    })
    expect(metric).toMatchObject({ step: 3, memoryGpuBytes: 7_500, memoryCpuBytes: 2_500, loadedContextLength: 4096 })
  })
})
