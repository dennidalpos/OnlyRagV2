import { describe, it, expect } from 'vitest'
import { HardwareProfileResolver, AGENT_STOP_SEQUENCES } from './hardwareProfileResolver'

describe('HardwareProfileResolver Domain Unit Tests', () => {
  it('should resolve Low profile with 4096 context and thread throttling', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Low', { cpuCount: 8 })
    expect(opts.num_ctx).toBe(4096)
    expect(opts.num_thread).toBe(7)
    expect(opts.maxContextChars).toBe(16000)
    expect(opts.temperature).toBe(0.1)
  })

  it('should resolve Medium profile with 8192 context and 28k max context chars, and still pin num_thread (a Medium profile can run on a CPU-only machine)', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Medium', { cpuCount: 8 })
    expect(opts.num_ctx).toBe(8192)
    expect(opts.maxContextChars).toBe(28000)
    expect(opts.num_thread).toBe(7)
  })

  it('should resolve High profile with 16384 context and 48k max context chars, and still pin num_thread', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('High', { cpuCount: 8 })
    expect(opts.num_ctx).toBe(16384)
    expect(opts.maxContextChars).toBe(48000)
    expect(opts.num_thread).toBe(7)
  })

  it('should cap generation with a tier-scaled num_predict and ship the shared stop sequences on every profile', () => {
    const low = HardwareProfileResolver.resolveOllamaOptions('Low', { cpuCount: 4 }, 'fast')
    const high = HardwareProfileResolver.resolveOllamaOptions('High', { cpuCount: 4 }, 'deep_reasoning')

    expect(low.num_predict).toBe(4096)
    expect(high.num_predict).toBe(8192)
    expect(low.stop).toEqual(AGENT_STOP_SEQUENCES)
    expect(high.stop).toEqual(AGENT_STOP_SEQUENCES)
    // Never the closing code fence: write_file payloads routinely contain markdown fences.
    expect(low.stop.some((s) => s.trim() === '```')).toBe(false)
  })

  it('should dynamically resolve Auto profile to High when 16GB VRAM GPU is detected', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: true,
      vramTotalMB: 16384,
      systemRamGB: 32,
    })
    expect(opts.num_ctx).toBe(16384)
    expect(opts.maxContextChars).toBe(48000)
  })

  it('should dynamically resolve Auto profile to Medium (not Low) for an entry-tier 6GB VRAM GPU, matching chatContextBudget.ts\'s treatment of the entry tier', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: true,
      vramTotalMB: 6144,
      systemRamGB: 16,
    })
    expect(opts.num_ctx).toBe(8192)
    expect(opts.maxContextChars).toBe(28000)
  })

  it('should dynamically resolve Auto profile to Medium when 8GB VRAM GPU is detected', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: true,
      vramTotalMB: 8192,
      systemRamGB: 16,
    })
    expect(opts.num_ctx).toBe(8192)
    expect(opts.maxContextChars).toBe(28000)
  })

  it('should dynamically resolve Auto profile to Low when no dedicated GPU is detected', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: false,
      vramTotalMB: 0,
      systemRamGB: 8,
      cpuCount: 6,
    })
    expect(opts.num_ctx).toBe(4096)
    expect(opts.num_thread).toBe(5)
    expect(opts.maxContextChars).toBe(16000)
  })

  it('should adapt context budget and num_ctx dynamically based on ComplexityTier', () => {
    // Fast tier on Medium profile gives lower context for super-fast latency
    const fastOpts = HardwareProfileResolver.resolveOllamaOptions('Medium', undefined, 'fast')
    expect(fastOpts.num_ctx).toBe(4096)
    expect(fastOpts.maxContextChars).toBe(16000)

    // Deep reasoning tier on Medium profile uses safe 8k context window to prevent OOM
    const deepOpts = HardwareProfileResolver.resolveOllamaOptions('Medium', undefined, 'deep_reasoning')
    expect(deepOpts.num_ctx).toBe(8192)
    expect(deepOpts.maxContextChars).toBe(28000)

    // Deep reasoning tier on High profile expands up to 32k context
    const deepHighOpts = HardwareProfileResolver.resolveOllamaOptions('High', undefined, 'deep_reasoning')
    expect(deepHighOpts.num_ctx).toBe(32768)
    expect(deepHighOpts.maxContextChars).toBe(64000)
  })

  it('should upgrade effective tier to Medium on GPU-less machine when enableSystemRamOffloading is true and RAM is >= 16GB', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: false,
      vramTotalMB: 0,
      systemRamGB: 32,
      cpuCount: 8,
      enableSystemRamOffloading: true,
    })
    expect(opts.num_ctx).toBe(8192)
    expect(opts.maxContextChars).toBe(28000)
  })
})
