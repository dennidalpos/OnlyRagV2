import { describe, it, expect } from 'vitest'
import {
  analyzeHardwareAndRecommend,
  calculateRealUsableVram,
  calculateTotalModelFootprintGB,
  assessModelHardwareCompatibility,
  estimateKvCacheMemoryGB,
  getModelFamily,
  getModelApproxSize,
  formatModelDisplayName,
  isOllamaModelInstalled,
  findMatchingInstalledModel,
  getRecommendedOllamaEnvVars,
} from './hardwareRecommendationEngine'
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

  it('should calculate KV cache and total model footprint accurately', () => {
    // KV Cache Q8 at 4096 tokens
    const kv4k = estimateKvCacheMemoryGB(4096, true)
    expect(kv4k).toBeGreaterThanOrEqual(0.2)
    expect(kv4k).toBeLessThanOrEqual(0.4)

    // Total footprint for 1.5B model
    const fp1_5b = calculateTotalModelFootprintGB('qwen2.5-coder:1.5b', 4096, true)
    expect(fp1_5b).toBeGreaterThan(1.0)
    expect(fp1_5b).toBeLessThan(2.0)

    // Total footprint for 7B model
    const fp7b = calculateTotalModelFootprintGB('qwen2.5-coder:7b', 4096, true)
    expect(fp7b).toBeGreaterThan(4.5)
    expect(fp7b).toBeLessThan(5.5)

    // Total footprint for 14B model
    const fp14b = calculateTotalModelFootprintGB('qwen2.5-coder:14b', 4096, true)
    expect(fp14b).toBeGreaterThan(8.5)
  })

  it('should accurately evaluate hardware compatibility and flag OOM risks', () => {
    // 8GB GPU (safe budget = 4.5GB)
    const fit1 = assessModelHardwareCompatibility('qwen2.5-coder:1.5b', 8192, 16)
    expect(fit1.isCompatible).toBe(true)
    expect(fit1.compatibilityStatus).toBe('optimal_vram')

    const fit2 = assessModelHardwareCompatibility('qwen2.5-coder:3b', 8192, 16)
    expect(fit2.isCompatible).toBe(true)
    expect(fit2.compatibilityStatus).toBe('optimal_vram')

    // 14B model on 8GB GPU -> exceeds VRAM
    const fit3 = assessModelHardwareCompatibility('qwen2.5-coder:14b', 8192, 16)
    expect(fit3.isCompatible).toBe(false)
    expect(fit3.compatibilityStatus).toBe('exceeds_vram')
    expect(fit3.warning).toContain('VRAM insufficiente')

    // 32B model on 8GB GPU -> exceeds VRAM
    const fit4 = assessModelHardwareCompatibility('deepseek-r1:32b', 8192, 16)
    expect(fit4.isCompatible).toBe(false)
    expect(fit4.compatibilityStatus).toBe('exceeds_vram')
  })

  it('should recommend legacy profile for CPU-only or low VRAM hardware (< 4GB)', () => {
    const diag = createMockDiagnostics(false, 0, 8)
    const recs = analyzeHardwareAndRecommend(diag)

    expect(recs.profileTier).toBe('legacy')
    expect(recs.profileName).toContain('Legacy / CPU-Only Hardware')

    const recFast = recs.fastTierModels.find((m) => m.isRecommended)
    expect(recFast?.modelName).toBe('qwen2.5-coder:1.5b')

    const recStd = recs.standardTierModels.find((m) => m.isRecommended)
    expect(recStd?.modelName).toBe('qwen2.5-coder:3b')

    const recDeep = recs.deepReasoningTierModels.find((m) => m.isRecommended)
    expect(recDeep?.modelName).toBe('deepseek-coder:6.7b')

    const recVision = recs.visionTierModels.find((m) => m.isRecommended)
    expect(recVision?.modelName).toBe('moondream:latest')

    const recChat = recs.chatTierModels.find((m) => m.isRecommended)
    expect(recChat?.modelName).toBe('llama3.2:3b')

    const recTrans = recs.translationTierModels.find((m) => m.isRecommended)
    expect(recTrans?.modelName).toBe('qwen2.5:1.5b')

    const recEmbed = recs.embeddingTierModels.find((m) => m.isRecommended)
    expect(recEmbed?.modelName).toBe('nomic-embed-text:latest')

    const recMed = recs.medicalTierModels.find((m) => m.isRecommended)
    expect(recMed?.modelName).toBe('llama3.2:3b')

    const recLaw = recs.legalTierModels.find((m) => m.isRecommended)
    expect(recLaw?.modelName).toBe('llama3.2:3b')
  })

  it('should recommend entry profile for budget GPU with 4GB-6GB VRAM preserving safety headroom', () => {
    const diag = createMockDiagnostics(true, 6144, 16, 'NVIDIA GeForce RTX 3050 Laptop')
    const recs = analyzeHardwareAndRecommend(diag)

    expect(recs.profileTier).toBe('entry')
    expect(recs.profileName).toContain('Entry-Level GPU')
    expect(recs.safeVramBudgetGB).toBe(3.0)

    const recStd = recs.standardTierModels.find((m) => m.isRecommended)
    expect(recStd?.modelName).toBe('qwen2.5-coder:3b')

    const recDeep = recs.deepReasoningTierModels.find((m) => m.isRecommended)
    expect(recDeep?.modelName).toBe('deepseek-coder:6.7b')

    const recVision = recs.visionTierModels.find((m) => m.isRecommended)
    expect(recVision?.modelName).toBe('moondream:latest')

    const recChat = recs.chatTierModels.find((m) => m.isRecommended)
    expect(recChat?.modelName).toBe('llama3.2:3b')
  })

  it('should recommend midrange profile for dedicated GPU with 8GB VRAM with coding workhorse models', () => {
    const diag = createMockDiagnostics(true, 8192, 16, 'NVIDIA GeForce RTX 2070')
    const recs = analyzeHardwareAndRecommend(diag)

    expect(recs.profileTier).toBe('midrange')
    expect(recs.profileName).toContain('Mid-Range GPU')
    expect(recs.safeVramBudgetGB).toBe(4.5)

    const recFast = recs.fastTierModels.find((m) => m.isRecommended)
    expect(recFast?.modelName).toBe('qwen2.5-coder:1.5b')

    const recStd = recs.standardTierModels.find((m) => m.isRecommended)
    expect(recStd?.modelName).toBe('qwen2.5-coder:7b')

    const recDeep = recs.deepReasoningTierModels.find((m) => m.isRecommended)
    expect(recDeep?.modelName).toBe('qwen2.5-coder:7b')

    const recVision = recs.visionTierModels.find((m) => m.isRecommended)
    expect(recVision?.modelName).toBe('moondream:latest')

    const recChat = recs.chatTierModels.find((m) => m.isRecommended)
    expect(recChat?.modelName).toBe('llama3.2:3b')

    const recTrans = recs.translationTierModels.find((m) => m.isRecommended)
    expect(recTrans?.modelName).toBe('qwen2.5:3b')

    const recEmbed = recs.embeddingTierModels.find((m) => m.isRecommended)
    expect(recEmbed?.modelName).toBe('nomic-embed-text:latest')

    const recMed = recs.medicalTierModels.find((m) => m.isRecommended)
    expect(recMed?.modelName).toBe('llama3.2:3b')

    const recLaw = recs.legalTierModels.find((m) => m.isRecommended)
    expect(recLaw?.modelName).toBe('llama3.2:3b')
  })

  it('should recommend highend profile for high-end GPU with >= 12GB VRAM', () => {
    const diag = createMockDiagnostics(true, 16384, 32, 'NVIDIA GeForce RTX 4080')
    const recs = analyzeHardwareAndRecommend(diag)

    expect(recs.profileTier).toBe('highend')
    expect(recs.profileName).toContain('High-End Performance GPU')
    expect(recs.safeVramBudgetGB).toBe(10.5)

    const recFast = recs.fastTierModels.find((m) => m.isRecommended)
    expect(recFast?.modelName).toBe('qwen2.5-coder:3b')

    const recStd = recs.standardTierModels.find((m) => m.isRecommended)
    expect(recStd?.modelName).toBe('qwen2.5-coder:7b')

    const recDeep = recs.deepReasoningTierModels.find((m) => m.isRecommended)
    expect(recDeep?.modelName).toBe('qwen2.5-coder:14b')

    const recVision = recs.visionTierModels.find((m) => m.isRecommended)
    expect(recVision?.modelName).toBe('llava:7b')

    const recChat = recs.chatTierModels.find((m) => m.isRecommended)
    expect(recChat?.modelName).toBe('llama3.1:8b')

    const recTrans = recs.translationTierModels.find((m) => m.isRecommended)
    expect(recTrans?.modelName).toBe('qwen2.5:7b')

    const recEmbed = recs.embeddingTierModels.find((m) => m.isRecommended)
    expect(recEmbed?.modelName).toBe('bge-m3:latest')
  })

  it('should recommend extreme profile for 24GB+ workstations', () => {
    const diag = createMockDiagnostics(true, 24576, 64, 'NVIDIA GeForce RTX 4090')
    const recs = analyzeHardwareAndRecommend(diag)

    expect(recs.profileTier).toBe('extreme')
    expect(recs.profileName).toContain('Extreme Workstation')
    expect(recs.safeVramBudgetGB).toBe(16.5)

    const recStd = recs.standardTierModels.find((m) => m.isRecommended)
    expect(recStd?.modelName).toBe('qwen2.5-coder:14b')

    const recDeep = recs.deepReasoningTierModels.find((m) => m.isRecommended)
    expect(recDeep?.modelName).toBe('qwen2.5-coder:32b')

    const recVision = recs.visionTierModels.find((m) => m.isRecommended)
    expect(recVision?.modelName).toBe('llama3.2-vision:11b')

    const recTrans = recs.translationTierModels.find((m) => m.isRecommended)
    expect(recTrans?.modelName).toBe('aya-expanse:8b')

    const recMed = recs.medicalTierModels.find((m) => m.isRecommended)
    expect(recMed?.modelName).toBe('meditron:70b')

    const recLaw = recs.legalTierModels.find((m) => m.isRecommended)
    expect(recLaw?.modelName).toBe('command-r:35b')
  })

  it('should format model display names and compute sizes and families correctly', () => {
    expect(getModelFamily('adrienbrault/biomistral-7b:Q4_K_M')).toBe('biomistral')
    expect(getModelFamily('qwen2.5-coder:7b')).toBe('qwen-coder')
    expect(getModelFamily('llama3.2-vision:11b')).toBe('llama-vision')
    expect(getModelFamily('deepseek-r1:14b')).toBe('deepseek-r1')
    expect(getModelFamily('bge-m3:latest')).toBe('bge')

    expect(getModelApproxSize('adrienbrault/biomistral-7b:Q4_K_M')).toBe('4.1 GB')
    expect(getModelApproxSize('qwen2.5-coder:7b')).toBe('4.7 GB')
    expect(getModelApproxSize('nomic-embed-text:latest')).toBe('276 MB')
    expect(getModelApproxSize('local')).toBeUndefined()

    expect(formatModelDisplayName('adrienbrault/biomistral-7b:Q4_K_M')).toBe('BioMistral (7B Q4_K_M)')
    expect(formatModelDisplayName('meditron:7b')).toBe('Meditron (7B)')
  })

  it('should handle null diagnostics gracefully with fallback defaults', () => {
    const recs = analyzeHardwareAndRecommend(null)
    expect(recs.profileTier).toBe('legacy')
    expect(recs.gpuSummary).toContain('No Dedicated GPU Detected')
    expect(recs.medicalTierModels.length).toBeGreaterThan(0)
    expect(recs.legalTierModels.length).toBeGreaterThan(0)
  })

  it('should accurately detect installed models with exact tag matching and latest tag equivalence', () => {
    const installed = [
      'qwen2.5-coder:7b',
      'deepseek-r1:8b',
      'nomic-embed-text:latest',
      'adrienbrault/biomistral-7b:q4_k_m',
    ]

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

  it('should generate correct OS environment variables and scripts based on hardware', () => {
    // 1. CPU-Only
    const cpuDiag = createMockDiagnostics(false, 0, 8)
    const cpuEnv = getRecommendedOllamaEnvVars(cpuDiag)
    expect(cpuEnv.profileTier).toBe('legacy')
    expect(cpuEnv.variables.find((v) => v.name === 'OLLAMA_FLASH_ATTENTION')?.value).toBe('0')
    expect(cpuEnv.variables.find((v) => v.name === 'OLLAMA_NUM_PARALLEL')?.value).toBe('1')
    expect(cpuEnv.powershellScript).toContain('[System.Environment]::SetEnvironmentVariable')

    // 2. Midrange GPU (8GB)
    const midDiag = createMockDiagnostics(true, 8192, 16, 'NVIDIA GeForce RTX 4060')
    const midEnv = getRecommendedOllamaEnvVars(midDiag)
    expect(midEnv.profileTier).toBe('midrange')
    expect(midEnv.variables.find((v) => v.name === 'OLLAMA_FLASH_ATTENTION')?.value).toBe('1')
    expect(midEnv.variables.find((v) => v.name === 'OLLAMA_KV_CACHE_TYPE')?.value).toBe('q8_0')
    expect(midEnv.variables.find((v) => v.name === 'OLLAMA_NUM_PARALLEL')?.value).toBe('2')

    // 3. Extreme Workstation (24GB+)
    const extDiag = createMockDiagnostics(true, 24576, 64, 'NVIDIA GeForce RTX 4090')
    const extEnv = getRecommendedOllamaEnvVars(extDiag)
    expect(extEnv.profileTier).toBe('extreme')
    expect(extEnv.variables.find((v) => v.name === 'OLLAMA_NUM_PARALLEL')?.value).toBe('4')
    expect(extEnv.variables.find((v) => v.name === 'OLLAMA_MAX_LOADED_MODELS')?.value).toBe('3')
  })
})
