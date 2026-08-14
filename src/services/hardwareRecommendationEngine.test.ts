import { describe, it, expect } from 'vitest'
import { analyzeHardwareAndRecommend } from './hardwareRecommendationEngine'
import { DiagnosticsData } from '../types'

describe('hardwareRecommendationEngine Unit Tests', () => {
  const createMockDiagnostics = (
    hasGpu: boolean,
    vramMB: number,
    ramGB: number,
    gpuName = 'NVIDIA GeForce RTX 4070'
  ): DiagnosticsData => ({
    gpu: {
      hasNvidiaGpu: hasGpu,
      gpuName: hasGpu ? gpuName : 'CPU',
      vramTotalMB: vramMB,
      vramUsedMB: 1024,
      cudaVersion: hasGpu ? '12.4' : undefined,
    },
    memory: {
      totalRAMGB: ramGB,
      freeRAMGB: ramGB / 2,
      usedRAMGB: ramGB / 2,
      ramUsagePercent: 50,
    },
    ollama: {
      status: 'online',
      url: 'http://127.0.0.1:11434',
      modelsCount: 2,
      models: ['llama3.2:3b', 'nomic-embed-text'],
    },
    sidecar: {
      status: 'online',
      endpoint: 'http://127.0.0.1:8000',
      documentsCount: 5,
      chunksCount: 20,
    },
    system: {
      platform: 'win32',
      arch: 'x64',
      cpusCount: 16,
      cpuModel: 'AMD Ryzen 7',
    },
    timestamp: new Date().toISOString(),
  })

  it('should recommend legacy profile for CPU-only or low VRAM hardware (< 4GB)', () => {
    const diag = createMockDiagnostics(false, 0, 8)
    const recs = analyzeHardwareAndRecommend(diag)

    expect(recs.profileTier).toBe('legacy')
    expect(recs.profileName).toContain('Legacy / CPU-Only Hardware')

    const recFast = recs.fastTierModels.find((m) => m.isRecommended)
    expect(recFast?.modelName).toBe('llama3.2:1b')

    const recStd = recs.standardTierModels.find((m) => m.isRecommended)
    expect(recStd?.modelName).toBe('llama3.1:8b')

    const recDeep = recs.deepReasoningTierModels.find((m) => m.isRecommended)
    expect(recDeep?.modelName).toBe('deepseek-r1:1.5b')

    const recVision = recs.visionTierModels.find((m) => m.isRecommended)
    expect(recVision?.modelName).toBe('qwen2.5vl:3b')

    const recEmbed = recs.embeddingTierModels.find((m) => m.isRecommended)
    expect(recEmbed?.modelName).toBe('nomic-embed-text')
  })

  it('should recommend midrange profile for dedicated GPU with 8GB VRAM', () => {
    const diag = createMockDiagnostics(true, 8192, 16)
    const recs = analyzeHardwareAndRecommend(diag)

    expect(recs.profileTier).toBe('midrange')
    expect(recs.profileName).toContain('Mid-Range Hardware')

    const recFast = recs.fastTierModels.find((m) => m.isRecommended)
    expect(recFast?.modelName).toBe('llama3.2:3b')

    const recStd = recs.standardTierModels.find((m) => m.isRecommended)
    expect(recStd?.modelName).toBe('qwen2.5-coder:7b')

    const recDeep = recs.deepReasoningTierModels.find((m) => m.isRecommended)
    expect(recDeep?.modelName).toBe('deepseek-r1:8b')

    const recVision = recs.visionTierModels.find((m) => m.isRecommended)
    expect(recVision?.modelName).toBe('qwen2.5vl:3b')

    const recEmbed = recs.embeddingTierModels.find((m) => m.isRecommended)
    expect(recEmbed?.modelName).toBe('nomic-embed-text')
  })

  it('should recommend highend profile for high-end GPU with >= 12GB VRAM', () => {
    const diag = createMockDiagnostics(true, 16384, 32, 'NVIDIA GeForce RTX 4090')
    const recs = analyzeHardwareAndRecommend(diag)

    expect(recs.profileTier).toBe('highend')
    expect(recs.profileName).toContain('High-Performance Hardware')

    const recFast = recs.fastTierModels.find((m) => m.isRecommended)
    expect(recFast?.modelName).toBe('llama3.2:3b')

    const recStd = recs.standardTierModels.find((m) => m.isRecommended)
    expect(recStd?.modelName).toBe('qwen2.5-coder:7b')

    const recDeep = recs.deepReasoningTierModels.find((m) => m.isRecommended)
    expect(recDeep?.modelName).toBe('qwen2.5-coder:14b')

    const recVision = recs.visionTierModels.find((m) => m.isRecommended)
    expect(recVision?.modelName).toBe('llama3.2-vision:11b')

    const recEmbed = recs.embeddingTierModels.find((m) => m.isRecommended)
    expect(recEmbed?.modelName).toBe('mxbai-embed-large')
  })

  it('should handle null diagnostics gracefully with fallback defaults', () => {
    const recs = analyzeHardwareAndRecommend(null)
    expect(recs.profileTier).toBe('legacy')
    expect(recs.gpuSummary).toContain('No Dedicated GPU Detected')
  })
})
