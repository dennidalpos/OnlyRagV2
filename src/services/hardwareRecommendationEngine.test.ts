import { describe, it, expect } from 'vitest'
import {
  analyzeHardwareAndRecommend,
  estimateModelWeightGB,
  getModelApproxSize,
  isOllamaModelInstalled,
  buildModelFitLookup,
} from './hardwareRecommendationEngine'
import { findMatchingInstalledModel } from '../../shared/domain/agent/modelTagMatcher'
import { calculateRealUsableVram } from '../../shared/domain/hardware/hardwareProfileTiers'
import { DiagnosticsData, RunningModelDetails } from '../types'
import { DEFAULT_APP_SETTINGS } from '../../shared/domain/settings/appSettingsDefaults'

describe('hardwareRecommendationEngine Unit Tests', () => {
  const createMockDiagnostics = (hasGpu: boolean, vramMB: number, ramGB: number, gpuName = 'NVIDIA GeForce RTX 4070'): DiagnosticsData => ({
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
    requirements: {
      isOsSupported: true,
      hasMinRam: true,
      hasRecRam: true,
      isOllamaReady: true,
      isGpuAccelerated: hasGpu,
      isSidecarReady: true,
      overallStatus: 'optimal',
    },
    timestamp: new Date().toISOString(),
  })

  it('should calculate analytical net usable safe VRAM correctly', () => {
    // 0 MB (CPU) -> 0 GB
    expect(calculateRealUsableVram(0)).toBe(0)

    // 4096 MB (4GB) -> (4 * 0.75) - 1.5 = 1.5 GB
    expect(calculateRealUsableVram(4096)).toBe(1.5)

    // 6144 MB (6GB) -> (6 * 0.75) - 1.5 = 3.0 GB
    expect(calculateRealUsableVram(6144)).toBe(3.0)

    // 8192 MB (8GB) -> (8 * 0.75) - 1.5 = 4.5 GB
    expect(calculateRealUsableVram(8192)).toBe(4.5)

    // 12288 MB (12GB) -> (12 * 0.75) - 1.5 = 7.5 GB
    expect(calculateRealUsableVram(12288)).toBe(7.5)

    // 16384 MB (16GB) -> (16 * 0.75) - 1.5 = 10.5 GB
    expect(calculateRealUsableVram(16384)).toBe(10.5)

    // 24576 MB (24GB) -> (24 * 0.75) - 1.5 = 16.5 GB
    expect(calculateRealUsableVram(24576)).toBe(16.5)
  })

  describe('estimateModelWeightGB with real Ollama metadata (B3)', () => {
    it('should compute weight from parameter_size + quantization_level when details are provided', () => {
      const details: RunningModelDetails = { parameter_size: '7.6B', quantization_level: 'Q4_K_M' }
      // 7.6B params * 0.60 bytes/param (Q4_K_M) / 1024^3 ≈ 4.25 GB
      expect(estimateModelWeightGB('deepseek-r1:7b-qwen-distill-q4_k_m', details)).toBe(4.25)
    })

    it('should scale weight with quantization level for the same parameter count', () => {
      const q4: RunningModelDetails = { parameter_size: '8B', quantization_level: 'Q4_K_M' }
      const q8: RunningModelDetails = { parameter_size: '8B', quantization_level: 'Q8_0' }
      const f16: RunningModelDetails = { parameter_size: '8B', quantization_level: 'F16' }

      const q4Weight = estimateModelWeightGB('some-model:8b', q4)
      const q8Weight = estimateModelWeightGB('some-model:8b', q8)
      const f16Weight = estimateModelWeightGB('some-model:8b', f16)

      expect(q4Weight).toBeLessThan(q8Weight)
      expect(q8Weight).toBeLessThan(f16Weight)
    })

    it('should handle parameter_size in millions (M) correctly', () => {
      const details: RunningModelDetails = { parameter_size: '568M', quantization_level: 'Q8_0' }
      // 0.568B params * 1.06 bytes/param / 1024^3 ≈ 0.56 GB
      const weight = estimateModelWeightGB('embed-model:latest', details)
      expect(weight).toBeGreaterThan(0.4)
      expect(weight).toBeLessThan(0.7)
    })

    it('should fall back to the static table when details are unparseable', () => {
      const badDetails: RunningModelDetails = { parameter_size: 'unknown', quantization_level: 'Q4_K_M' }
      const withBadDetails = estimateModelWeightGB('qwen2.5-coder:7b', badDetails)
      const withoutDetails = estimateModelWeightGB('qwen2.5-coder:7b')
      expect(withBadDetails).toBe(withoutDetails)
    })

    it('uses a conservative fallback when Ollama metadata is unavailable', () => {
      expect(estimateModelWeightGB('qwen2.5-coder:7b')).toBeGreaterThan(0)
      expect(estimateModelWeightGB('llama3.1:8b')).toBeGreaterThan(0)
    })
  })

  it('keeps hardware profile detection independent of model catalogs', () => {
    expect(analyzeHardwareAndRecommend(createMockDiagnostics(false, 0, 8)).profileTier).toBe('legacy')
    expect(analyzeHardwareAndRecommend(createMockDiagnostics(true, 8192, 16)).profileTier).toBe('midrange')
    expect(analyzeHardwareAndRecommend(createMockDiagnostics(true, 20480, 64)).profileTier).toBe('extreme')
  })

  it('should compute approximate sizes correctly', () => {
    expect(getModelApproxSize('adrienbrault/biomistral-7b:Q4_K_M')).toBe('4.1 GB')
    expect(getModelApproxSize('qwen2.5-coder:7b')).toBe('7.6 GB')
    expect(getModelApproxSize('nomic-embed-text:latest')).toBe('276 MB')
    expect(getModelApproxSize('local')).toBeUndefined()
  })

  it('should handle null diagnostics gracefully with fallback defaults', () => {
    const recs = analyzeHardwareAndRecommend(null)
    expect(recs.profileTier).toBe('legacy')
    expect(recs.gpuSummary).toContain('No Dedicated GPU Detected')
  })

  it('should accurately detect installed models with exact tag matching and latest tag equivalence', () => {
    const installed = ['qwen2.5-coder:7b', 'deepseek-r1:8b', 'nomic-embed-text:latest', 'adrienbrault/biomistral-7b:q4_k_m']

    // Exact matches
    expect(isOllamaModelInstalled('qwen2.5-coder:7b', installed)).toBe(true)
    expect(isOllamaModelInstalled('deepseek-r1:8b', installed)).toBe(true)
    expect(isOllamaModelInstalled('nomic-embed-text', installed)).toBe(true)
    expect(isOllamaModelInstalled('nomic-embed-text:latest', installed)).toBe(true)
    expect(isOllamaModelInstalled('biomistral-7b:q4_k_m', installed)).toBe(true)

    // MUST NOT match different parameter tags
    expect(isOllamaModelInstalled('qwen2.5-coder:1.5b', installed)).toBe(false)
    expect(isOllamaModelInstalled('qwen2.5-coder:14b', installed)).toBe(false)
    expect(isOllamaModelInstalled('deepseek-r1:14b', installed)).toBe(false)
    expect(isOllamaModelInstalled('llama3.1:8b', installed)).toBe(false)
  })

  it('should find matching installed models from local tags', () => {
    const installed = ['qwen2.5-coder:7b', 'llama3.2:latest', 'bge-m3:latest']

    expect(findMatchingInstalledModel('qwen2.5-coder:7b', installed)).toBe('qwen2.5-coder:7b')
    expect(findMatchingInstalledModel('llama3.2', installed)).toBe('llama3.2:latest')
    expect(findMatchingInstalledModel('bge-m3', installed)).toBe('bge-m3:latest')
    expect(findMatchingInstalledModel('nonexistent-model', installed)).toBeNull()
  })

  it('should resolve fuzzy quant-tag and loose substring base matches via the consolidated matcher (AGT4: shared through modelTagMatcher)', () => {
    const installed = ['qwen2.5-coder:7b-instruct-q4_k_m']
    // Compatible quant/instruction tag fuzzy match
    expect(findMatchingInstalledModel('qwen2.5-coder:7b', installed)).toBe('qwen2.5-coder:7b-instruct-q4_k_m')
    // Loose substring base match (target base is a substring of the installed base)
    expect(findMatchingInstalledModel('qwen2.5', installed)).toBe('qwen2.5-coder:7b-instruct-q4_k_m')
  })

  describe('buildModelFitLookup', () => {
    it('uses setup context, overrides and the trained ceiling instead of fixed 4K', () => {
      const diagnostics = createMockDiagnostics(true, 8192, 32)
      const metrics = { model: { capabilities: ['completion'], contextLength: 16384, sizeBytes: 2 * 1024 ** 3 } }
      expect(buildModelFitLookup(diagnostics, DEFAULT_APP_SETTINGS, metrics, true)('model').contextTokens).toBe(16384)
      const settings = { ...DEFAULT_APP_SETTINGS, modelContextLengths: { model: 8192 } }
      expect(buildModelFitLookup(diagnostics, settings, metrics, true)('model').contextTokens).toBe(8192)
    })

    it('keeps unknown architecture and remote hardware explicitly uncertain', () => {
      const diagnostics = createMockDiagnostics(true, 8192, 32)
      const metrics = { model: { capabilities: ['completion'], contextLength: 32768, sizeBytes: 2 * 1024 ** 3 } }
      expect(buildModelFitLookup(diagnostics, DEFAULT_APP_SETTINGS, metrics)('model').placement).toBe('unknown')
      expect(buildModelFitLookup(diagnostics, { ...DEFAULT_APP_SETTINGS, ollamaMode: 'remote' }, metrics)('model').placement).toBe('unknown')
      expect(buildModelFitLookup(null, DEFAULT_APP_SETTINGS, metrics)('model').placement).toBe('unknown')
      expect(
        buildModelFitLookup(diagnostics, { ...DEFAULT_APP_SETTINGS, ollamaMode: 'local', ollamaHost: 'http://localhost.remote.test:11434' }, metrics)('model')
          .placement,
      ).toBe('unknown')
    })

    it('shares the preserved agent default and uses the same persisted override across roles', () => {
      const diagnostics = createMockDiagnostics(true, 16384, 32)
      const metrics = { model: { capabilities: ['completion'], contextLength: 131072 } }
      const lookup = buildModelFitLookup(diagnostics, DEFAULT_APP_SETTINGS, metrics)
      expect(lookup('model', true).contextTokens).toBe(65536)
      expect(lookup('model').contextTokens).toBe(32768)
      const pinned = buildModelFitLookup(diagnostics, { ...DEFAULT_APP_SETTINGS, modelContextLengths: { model: 8192 } }, metrics)
      expect(pinned('model', true).contextTokens).toBe(pinned('model').contextTokens)
    })
  })
})
