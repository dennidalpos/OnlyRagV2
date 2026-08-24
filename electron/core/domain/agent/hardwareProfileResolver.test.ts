import { describe, it, expect } from 'vitest'
import { HardwareProfileResolver, AGENT_STOP_SEQUENCES } from './hardwareProfileResolver'

describe('HardwareProfileResolver Domain Unit Tests', () => {
  it('should resolve Low profile with 4096 context and thread throttling', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Low', { cpuCount: 8 })
    expect(opts.num_ctx).toBe(4096)
    expect(opts.num_thread).toBe(7)
    expect(opts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(4096))
    expect(opts.temperature).toBe(0.1)
  })

  it('should resolve Medium profile with 8192 context, and still pin num_thread (a Medium profile can run on a CPU-only machine)', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Medium', { cpuCount: 8 })
    expect(opts.num_ctx).toBe(8192)
    expect(opts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(8192))
    expect(opts.num_thread).toBe(7)
  })

  it('should resolve High profile with 16384 context, and still pin num_thread', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('High', { cpuCount: 8 })
    expect(opts.num_ctx).toBe(16384)
    expect(opts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(16384))
    expect(opts.num_thread).toBe(7)
  })

  it('should cap generation with a window-derived num_predict and ship the shared stop sequences on every profile', () => {
    const low = HardwareProfileResolver.resolveOllamaOptions('Low', { cpuCount: 4 })
    const high = HardwareProfileResolver.resolveOllamaOptions('High', { cpuCount: 4 })

    expect(low.num_predict).toBe(HardwareProfileResolver.deriveNumPredict(4096))
    expect(high.num_predict).toBe(HardwareProfileResolver.deriveNumPredict(16384))
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
    expect(opts.num_ctx).toBe(32768)
    expect(opts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(opts.num_ctx))
  })

  it('should dynamically resolve Auto profile to Medium (not Low) for an entry-tier 6GB VRAM GPU, matching chatContextBudget.ts\'s treatment of the entry tier', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: true,
      vramTotalMB: 6144,
      systemRamGB: 16,
    })
    expect(opts.num_ctx).toBe(16384)
    expect(opts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(opts.num_ctx))
  })

  it('should dynamically resolve Auto profile to Medium tier with RAM-upgraded 16K context when 8GB VRAM GPU is detected and 16GB RAM is available', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: true,
      vramTotalMB: 8192,
      systemRamGB: 16,
    })
    expect(opts.num_ctx).toBe(16384)
    expect(opts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(opts.num_ctx))
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
    expect(opts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(opts.num_ctx))
  })

  it('should keep num_predict and maxContextChars inside the context window on every profile', () => {
    // Regression: these three used to be hand-set per tier and drifted apart — the Medium
    // profile shipped num_ctx 8192 with num_predict 6144 AND a 28000-char prompt budget, i.e.
    // it promised the prompt ~3x more room than the window could hold alongside generation.
    for (const profile of ['Low', 'Medium', 'High'] as const) {
      const opts = HardwareProfileResolver.resolveOllamaOptions(profile, { cpuCount: 4 })
      const promptTokenBudget = Math.ceil(opts.maxContextChars / 3.6)
      expect(opts.num_predict).toBeLessThan(opts.num_ctx)
      expect(promptTokenBudget + opts.num_predict).toBeLessThanOrEqual(opts.num_ctx)
    }
  })

  it('should upgrade effective tier to Medium on GPU-less machine when enableSystemRamOffloading is true and RAM is >= 16GB, then RAM-scale context to 32K', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: false,
      vramTotalMB: 0,
      systemRamGB: 32,
      cpuCount: 8,
      enableSystemRamOffloading: true,
    })
    expect(opts.num_ctx).toBe(32768)
    expect(opts.maxContextChars).toBe(HardwareProfileResolver.deriveMaxContextChars(opts.num_ctx))
  })
})
