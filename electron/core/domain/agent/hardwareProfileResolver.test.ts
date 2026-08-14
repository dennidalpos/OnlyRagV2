import { describe, it, expect } from 'vitest'
import { HardwareProfileResolver } from './hardwareProfileResolver'

describe('HardwareProfileResolver Domain Unit Tests', () => {
  it('should resolve Low profile with 4096 context and thread throttling', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Low', { cpuCount: 8 })
    expect(opts.num_ctx).toBe(4096)
    expect(opts.num_thread).toBe(7)
    expect(opts.maxContextChars).toBe(16000)
    expect(opts.temperature).toBe(0.1)
  })

  it('should resolve Medium profile with 8192 context and 32k max context chars', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Medium')
    expect(opts.num_ctx).toBe(8192)
    expect(opts.maxContextChars).toBe(32000)
    expect(opts.num_thread).toBeUndefined()
  })

  it('should resolve High profile with 16384 context and 48k max context chars', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('High')
    expect(opts.num_ctx).toBe(16384)
    expect(opts.maxContextChars).toBe(48000)
    expect(opts.num_thread).toBeUndefined()
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

  it('should dynamically resolve Auto profile to Medium when 8GB VRAM GPU is detected', () => {
    const opts = HardwareProfileResolver.resolveOllamaOptions('Auto', {
      hasGpu: true,
      vramTotalMB: 8192,
      systemRamGB: 16,
    })
    expect(opts.num_ctx).toBe(8192)
    expect(opts.maxContextChars).toBe(32000)
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

    // Deep reasoning tier on Medium profile expands context
    const deepOpts = HardwareProfileResolver.resolveOllamaOptions('Medium', undefined, 'deep_reasoning')
    expect(deepOpts.num_ctx).toBe(16384)
    expect(deepOpts.maxContextChars).toBe(48000)

    // Deep reasoning tier on High profile expands up to 32k context
    const deepHighOpts = HardwareProfileResolver.resolveOllamaOptions('High', undefined, 'deep_reasoning')
    expect(deepHighOpts.num_ctx).toBe(32768)
    expect(deepHighOpts.maxContextChars).toBe(64000)
  })
})
