import { DiagnosticsData } from '../types'

export type HardwareProfileTier = 'legacy' | 'entry' | 'midrange' | 'highend' | 'extreme'

export interface ModelRecommendation {
  modelName: string
  displayName: string
  family: string
  sizeBytesApprox: string
  description: string
  isRecommended: boolean
  footprintGB?: number
  isHardwareCompatible?: boolean
  compatibilityStatus?: 'optimal_vram' | 'tight_vram' | 'exceeds_vram'
  compatibilityWarning?: string
}

export interface OllamaEnvVarRecommendation {
  name: string
  value: string
  description: string
  rationale: string
}

export interface OllamaEnvConfig {
  profileTier: HardwareProfileTier
  variables: OllamaEnvVarRecommendation[]
  powershellScript: string
  bashScript: string
}

export interface HardwareRecommendations {
  profileTier: HardwareProfileTier
  profileName: string
  gpuSummary: string
  ramSummary: string
  safeVramBudgetGB: number
  fastTierModels: ModelRecommendation[]
  standardTierModels: ModelRecommendation[]
  deepReasoningTierModels: ModelRecommendation[]
  /** Heavy Escalation Tier (⚡): optional 14B+ models for complex multi-file tasks. Requires 12GB+ VRAM. */
  heavyEscalationTierModels: ModelRecommendation[]
  chatTierModels: ModelRecommendation[]
  translationTierModels: ModelRecommendation[]
  medicalTierModels: ModelRecommendation[]
  legalTierModels: ModelRecommendation[]
  visionTierModels: ModelRecommendation[]
  embeddingTierModels: ModelRecommendation[]
}

/**
 * Analytical VRAM budgeting constants:
 * - SAFETY_MARGIN: 25% reserve for dynamic KV Cache growth, token context expansion, background tasks.
 * - OVERHEAD_OS_GB: 1.5 GB fixed reserve for Windows Desktop Window Manager (DWM.exe) and display buffers.
 */
export const VRAM_SAFETY_MARGIN = 0.25
export const VRAM_OVERHEAD_OS_GB = 1.5

/**
 * Calculates net usable safe VRAM according to the analytical formula:
 * VRAM_Disponibile_Reale = (VRAM_Totale * (1 - Safety_Margin)) - Overhead_OS
 */
export function calculateRealUsableVram(vramTotalMB: number): number {
  if (!vramTotalMB || vramTotalMB <= 0) return 0
  const vramTotalGB = vramTotalMB / 1024
  const usable = vramTotalGB * (1 - VRAM_SAFETY_MARGIN) - VRAM_OVERHEAD_OS_GB
  return Math.max(0, Math.round(usable * 100) / 100)
}

/**
 * Derives a normalized model family badge from an Ollama model tag or name.
 */
export function getModelFamily(modelName: string): string {
  if (!modelName) return 'generic'
  const lower = modelName.toLowerCase().trim()
  if (lower.includes('biomistral')) return 'biomistral'
  if (lower.includes('meditron')) return 'meditron'
  if (lower.includes('qwen2.5-coder') || lower.includes('qwen-coder')) return 'qwen-coder'
  if (lower.includes('qwen')) return 'qwen'
  if (lower.includes('llama3.2-vision') || lower.includes('llama-vision')) return 'llama-vision'
  if (lower.includes('llama')) return 'llama'
  if (lower.includes('deepseek-r1')) return 'deepseek-r1'
  if (lower.includes('deepseek')) return 'deepseek'
  if (lower.includes('mistral') || lower.includes('codestral')) return 'mistral'
  if (lower.includes('gemma')) return 'gemma'
  if (lower.includes('phi')) return 'phi'
  if (lower.includes('aya') || lower.includes('command')) return 'cohere'
  if (lower.includes('llava')) return 'llava'
  if (lower.includes('minicpm')) return 'minicpm'
  if (lower.includes('moondream')) return 'moondream'
  if (lower.includes('nomic')) return 'nomic'
  if (lower.includes('bge')) return 'bge'
  if (lower.includes('mxbai')) return 'mxbai'
  if (lower.includes('snowflake')) return 'snowflake'
  if (lower.includes('minilm')) return 'minilm'
  return lower.split(':')[0].split('/')[0].split('-')[0] || 'generic'
}

/**
 * Returns estimated model weight in GB based on exact tag catalog or parameter heuristics.
 */
export function estimateModelWeightGB(modelName: string): number {
  if (!modelName) return 4.5
  const lower = modelName.toLowerCase().trim()
  if (lower === 'local' || lower === 'none') return 4.5

  const knownWeightsGB: Record<string, number> = {
    'all-minilm:latest': 0.12,
    'all-minilm': 0.12,
    'nomic-embed-text:latest': 0.27,
    'nomic-embed-text': 0.27,
    'snowflake-arctic-embed:latest': 0.6,
    'snowflake-arctic-embed': 0.6,
    'mxbai-embed-large:latest': 0.67,
    'mxbai-embed-large': 0.67,
    'bge-m3:latest': 1.1,
    'bge-m3': 1.1,
    'qwen2.5-coder:0.5b': 0.4,
    'qwen2.5:1.5b': 1.0,
    'qwen2.5-coder:1.5b': 1.1,
    'qwen2.5-coder:1.5b-instruct-q4_k_m': 1.0,
    'qwen2.5-coder:1.5b-instruct-q8_0': 1.6,
    'deepseek-r1:1.5b': 1.1,
    'llama3.2:1b': 1.3,
    'gemma2:2b': 1.6,
    'moondream:latest': 1.7,
    'moondream': 1.7,
    'qwen2.5-coder:3b': 1.9,
    'qwen2.5-coder:3b-instruct-q4_k_m': 1.8,
    'qwen2.5-coder:3b-instruct-q8_0': 3.2,
    'qwen2.5:3b': 1.9,
    'llama3.2:3b': 2.0,
    'starcoder2:3b': 2.0,
    'phi3.5:3.8b': 2.2,
    'deepseek-coder:6.7b': 3.8,
    'deepseek-coder:6.7b-instruct-q4_k_m': 3.8,
    'deepseek-coder:6.7b-instruct-q8_0': 7.2,
    'codellama:7b-instruct-q4_k_m': 4.0,
    'codellama:7b': 4.2,
    'mistral:7b': 4.1,
    'adrienbrault/biomistral-7b:q4_k_m': 4.1,
    'adrienbrault/biomistral-7b:Q4_K_M': 4.1,
    'adrienbrault/biomistral-7b': 4.1,
    'meditron:7b': 4.3,
    'starcoder2:7b': 4.4,
    'llava:7b': 4.5,
    'qwen2.5-coder:7b': 4.7,
    'qwen2.5-coder:7b-instruct-q4_k_m': 4.4,
    'qwen2.5-coder:7b-instruct-q5_k_m': 5.1,
    'qwen2.5-coder:7b-instruct-q8_0': 7.6,
    'qwen2.5:7b': 4.7,
    'deepseek-r1:7b': 4.7,
    'deepseek-r1:7b-qwen-distill-q4_k_m': 4.4,
    'llama3.1:8b': 4.9,
    'deepseek-r1:8b': 4.9,
    'deepseek-r1:8b-llama-distill-q4_k_m': 4.9,
    'aya-expanse:8b': 5.1,
    'minicpm-v:8b': 5.5,
    'gemma2:9b': 5.5,
    'codellama:13b': 7.8,
    'solar:10.7b': 6.8,
    'llama3.2-vision:11b': 7.9,
    'deepseek-coder-v2:16b-lite-instruct-q4_k_m': 8.9,
    'deepseek-coder-v2:16b-lite-instruct-q5_k_m': 10.5,
    'deepseek-coder-v2:16b': 8.9,
    'qwen2.5-coder:14b': 9.0,
    'qwen2.5-coder:14b-instruct-q4_k_m': 8.9,
    'qwen2.5-coder:14b-instruct-q5_k_m': 10.3,
    'qwen2.5-coder:14b-instruct-q8_0': 15.0,
    'qwen2.5:14b': 9.0,
    'starcoder2:15b': 9.2,
    'phi4:14b': 9.1,
    'phi4:14b-q4_k_m': 9.1,
    'deepseek-r1:14b': 9.2,
    'deepseek-r1:14b-qwen-distill-q4_k_m': 9.0,
    'codestral:22b': 13.0,
    'codestral:22b-v0.1-q4_k_m': 13.0,
    'codestral:22b-v0.1-q5_k_m': 15.5,
    'codellama:34b': 20.0,
    'deepseek-r1:32b': 20.0,
    'qwen2.5-coder:32b': 20.0,
    'qwen2.5-coder:32b-instruct-q4_k_m': 19.5,
    'command-r:35b': 20.0,
    'meditron:70b': 40.0,
    'llama3.3:70b': 40.0,
    'command-r-plus:104b': 60.0,
  }

  for (const [key, weight] of Object.entries(knownWeightsGB)) {
    if (lower === key || lower.startsWith(key) || key.startsWith(lower)) {
      return weight
    }
  }

  // Regex pattern matching for parameter sizes in billions (e.g. 0.5b, 1.5b, 7b, 8b, 14b, 32b, 70b)
  const bMatch = lower.match(/(?::|-|_|\b)(\d+(?:\.\d+)?)\s*b(?::|-|_|\b|$)/)
  if (bMatch) {
    const num = parseFloat(bMatch[1])
    if (!isNaN(num) && num > 0) {
      if (num <= 0.6) return 0.5
      if (num <= 1.2) return 1.1
      if (num <= 2.2) return 1.6
      if (num <= 3.5) return 2.0
      if (num <= 4.5) return 2.8
      if (num <= 7.2) return 4.4
      if (num <= 8.5) return 4.9
      if (num <= 9.5) return 5.5
      if (num <= 11.5) return 7.9
      if (num <= 14.5) return 9.0
      if (num <= 22.5) return 13.0
      if (num <= 27.5) return 17.0
      if (num <= 35.5) return 20.0
      if (num <= 72.0) return 40.0
      return num * 0.6
    }
  }

  // Regex pattern matching for parameter sizes in millions
  const mMatch = lower.match(/(?::|-|_|\b)(\d+)\s*m(?::|-|_|\b|$)/)
  if (mMatch) {
    const num = parseInt(mMatch[1], 10)
    if (!isNaN(num) && num > 0 && num < 1000) {
      return num / 1000
    }
  }

  return 4.5
}

/**
 * Returns an approximate memory/disk footprint string based on known model tags and parameter counts.
 */
export function getModelApproxSize(modelName: string): string | undefined {
  if (!modelName) return undefined
  const lower = modelName.toLowerCase().trim()
  if (lower === 'local' || lower === 'none') return undefined

  const weightGB = estimateModelWeightGB(modelName)
  if (weightGB < 1.0) {
    return `${Math.round(weightGB * 1024)} MB`
  }
  return `${weightGB.toFixed(1)} GB`
}

/**
 * Calculates KV-Cache VRAM footprint in GB:
 * KV_Cache = 2 * n_layers * n_kv_heads * head_dim * context_tokens * bytes_per_elem
 * Using standard Q8 quantization (1 byte/elem) or FP16 (2 bytes/elem).
 */
export function estimateKvCacheMemoryGB(contextTokens: number = 4096, isQuantizedQ8: boolean = true): number {
  const bytesPerElem = isQuantizedQ8 ? 1 : 2
  // Approximate standard 32 layers, 8 KV heads, 128 head dim
  const bytes = 2 * 32 * 8 * 128 * contextTokens * bytesPerElem
  const gb = bytes / (1024 * 1024 * 1024)
  return Math.round(gb * 100) / 100
}

/**
 * Calculates total model footprint in GB:
 * Footprint_Totale = VRAM_Modello + VRAM_KV_Cache + Overhead_CUDA
 */
export function calculateTotalModelFootprintGB(
  modelName: string,
  contextTargetTokens: number = 4096,
  isQuantizedQ8: boolean = true
): number {
  const weightGB = estimateModelWeightGB(modelName)
  const kvCacheGB = estimateKvCacheMemoryGB(contextTargetTokens, isQuantizedQ8)
  const cudaRuntimeOverheadGB = 0.25
  const total = weightGB + kvCacheGB + cudaRuntimeOverheadGB
  return Math.round(total * 100) / 100
}

/**
 * Assesses model compatibility against detected hardware and safe usable VRAM budget.
 */
export function assessModelHardwareCompatibility(
  modelName: string,
  vramTotalMB: number,
  totalRamGB: number,
  contextTargetTokens: number = 4096
): {
  isCompatible: boolean
  footprintGB: number
  safeVramBudgetGB: number
  compatibilityStatus: 'optimal_vram' | 'tight_vram' | 'exceeds_vram'
  warning?: string
} {
  const footprintGB = calculateTotalModelFootprintGB(modelName, contextTargetTokens, true)
  const safeVramBudgetGB = calculateRealUsableVram(vramTotalMB)
  const hasGpu = vramTotalMB > 0

  if (hasGpu && safeVramBudgetGB > 0) {
    if (footprintGB <= safeVramBudgetGB) {
      return {
        isCompatible: true,
        footprintGB,
        safeVramBudgetGB,
        compatibilityStatus: 'optimal_vram',
      }
    } else if (footprintGB <= safeVramBudgetGB + 1.2) {
      return {
        isCompatible: true,
        footprintGB,
        safeVramBudgetGB,
        compatibilityStatus: 'tight_vram',
        warning: 'Uso VRAM elevato: possibile rallentamento o swap con contesti lunghi.',
      }
    } else {
      return {
        isCompatible: false,
        footprintGB,
        safeVramBudgetGB,
        compatibilityStatus: 'exceeds_vram',
        warning: 'VRAM insufficiente: rischio elevato di Out-Of-Memory (OOM) o blocco driver.',
      }
    }
  }

  // CPU execution / No GPU
  const safeRamBudget = Math.max(2.0, totalRamGB * 0.7)
  if (footprintGB <= safeRamBudget) {
    return {
      isCompatible: true,
      footprintGB,
      safeVramBudgetGB: 0,
      compatibilityStatus: 'optimal_vram',
    }
  }
  return {
    isCompatible: false,
    footprintGB,
    safeVramBudgetGB: 0,
    compatibilityStatus: 'exceeds_vram',
    warning: 'RAM di sistema insufficiente per eseguire questo modello su CPU.',
  }
}

/**
 * Accurately determines if a target Ollama model tag is installed locally.
 */
export function isOllamaModelInstalled(targetModel: string, downloadedModels: string[]): boolean {
  if (!targetModel || !downloadedModels || downloadedModels.length === 0) return false
  const targetClean = targetModel.trim().toLowerCase()
  const targetBase = targetClean.split(':')[0]
  const targetTag = targetClean.includes(':') ? targetClean.split(':')[1] : ''
  const targetWithoutNamespace = targetClean.includes('/') ? targetClean.split('/')[1] : targetClean

  return downloadedModels.some((installed) => {
    const instClean = installed.trim().toLowerCase()
    // 1. Exact match
    if (instClean === targetClean) return true

    // 2. Default tag ':latest' equivalence
    if (targetTag === '' || targetTag === 'latest') {
      if (instClean === targetBase || instClean === `${targetBase}:latest`) return true
    }
    const instBase = instClean.split(':')[0]
    const instTag = instClean.includes(':') ? instClean.split(':')[1] : ''
    if (instTag === '' || instTag === 'latest') {
      if (targetClean === instBase || targetClean === `${instBase}:latest`) return true
    }

    // 3. Namespace strip match
    const instWithoutNamespace = instClean.includes('/') ? instClean.split('/')[1] : instClean
    if (targetWithoutNamespace === instWithoutNamespace) return true
    if (targetWithoutNamespace.split(':')[0] === instWithoutNamespace && (targetTag === '' || targetTag === 'latest')) return true
    if (instWithoutNamespace.split(':')[0] === targetWithoutNamespace && (instTag === '' || instTag === 'latest')) return true

    return false
  })
}

/**
 * Finds the exact matching installed model string from local Ollama tags.
 */
export function findMatchingInstalledModel(target: string, available: string[]): string | null {
  if (!target || !available || available.length === 0) return null
  const clean = target.toLowerCase().trim()
  const cleanBase = clean.split(':')[0]
  const cleanTag = clean.includes(':') ? clean.split(':')[1] : ''
  const cleanWithoutNamespace = clean.includes('/') ? clean.split('/')[1] : clean

  // 1. Exact case-insensitive match
  for (const m of available) {
    const mClean = m.toLowerCase().trim()
    if (mClean === clean) return m
  }

  // 2. :latest tag equivalence
  for (const m of available) {
    const mClean = m.toLowerCase().trim()
    if (mClean === `${clean}:latest` || `${mClean}:latest` === clean) return m
    if (!cleanTag && mClean.split(':')[0] === cleanBase && mClean.endsWith(':latest')) return m
  }

  // 3. Namespace strip match
  for (const m of available) {
    const mClean = m.toLowerCase().trim()
    const mWithoutNamespace = mClean.includes('/') ? mClean.split('/')[1] : mClean
    if (mWithoutNamespace === cleanWithoutNamespace) return m
  }

  return null
}

/**
 * Formats a clean display name for an Ollama tag.
 */
export function formatModelDisplayName(modelName: string): string {
  if (!modelName) return ''
  const lower = modelName.toLowerCase().trim()
  if (lower === 'qwen2.5-coder:7b-instruct-q4_k_m') return 'Qwen 2.5 Coder (7B Q4_K_M)'
  if (lower === 'qwen2.5-coder:7b-instruct-q5_k_m') return 'Qwen 2.5 Coder (7B Q5_K_M)'
  if (lower === 'qwen2.5-coder:7b-instruct-q8_0') return 'Qwen 2.5 Coder (7B Q8_0)'
  if (lower === 'qwen2.5-coder:14b-instruct-q4_k_m') return 'Qwen 2.5 Coder (14B Q4_K_M)'
  if (lower === 'qwen2.5-coder:32b-instruct-q4_k_m') return 'Qwen 2.5 Coder (32B Q4_K_M)'
  if (lower === 'deepseek-coder-v2:16b-lite-instruct-q4_k_m' || lower === 'deepseek-coder-v2:16b') return 'DeepSeek Coder V2 Lite (16B Q4_K_M)'
  if (lower === 'deepseek-coder:6.7b-instruct-q4_k_m') return 'DeepSeek Coder (6.7B Q4_K_M)'
  if (lower === 'deepseek-r1:7b-qwen-distill-q4_k_m' || lower === 'deepseek-r1:7b') return 'DeepSeek R1 Distill Qwen (7B)'
  if (lower === 'deepseek-r1:8b-llama-distill-q4_k_m' || lower === 'deepseek-r1:8b') return 'DeepSeek R1 Distill Llama (8B)'
  if (lower === 'deepseek-r1:14b-qwen-distill-q4_k_m' || lower === 'deepseek-r1:14b') return 'DeepSeek R1 Distill Qwen (14B)'
  if (lower === 'deepseek-r1:32b') return 'DeepSeek R1 Distill Qwen (32B)'
  if (lower === 'codestral:22b-v0.1-q4_k_m' || lower === 'codestral:22b') return 'Mistral Codestral (22B Q4_K_M)'
  if (lower === 'codellama:7b-instruct-q4_k_m') return 'Code Llama (7B Q4_K_M)'
  if (lower === 'adrienbrault/biomistral-7b:Q4_K_M' || lower === 'adrienbrault/biomistral-7b:q4_k_m') return 'BioMistral (7B Q4_K_M)'
  if (lower === 'meditron:7b') return 'Meditron (7B)'
  if (lower === 'meditron:70b') return 'Meditron (70B)'
  if (lower === 'bge-m3:latest' || lower === 'bge-m3') return 'BAAI BGE-M3 (1024d)'
  if (lower === 'nomic-embed-text:latest' || lower === 'nomic-embed-text') return 'Nomic Embed Text (768d)'
  const base = modelName.split(':')[0].replace(/^(adrienbrault\/|library\/)/, '')
  const tag = modelName.split(':')[1] || 'latest'
  return `${base} (${tag})`
}

/**
 * Analyzes detected host hardware and calculates calibrated, non-saturated model assignments
 * strictly bound by net usable VRAM budget: VRAM_Disponibile_Reale = (VRAM_Totale * 0.75) - 1.5 GB.
 */
export function analyzeHardwareAndRecommend(diagnostics: DiagnosticsData | null): HardwareRecommendations {
  const hasGpu = diagnostics?.gpu.hasNvidiaGpu || false
  const vramTotalMB = diagnostics?.gpu.vramTotalMB || 0
  const vramGB = Math.floor(vramTotalMB / 1024)
  const systemRamGB = Math.round(diagnostics?.memory.totalRAMGB || 8)

  const safeVramBudgetGB = calculateRealUsableVram(vramTotalMB)

  let profileTier: HardwareProfileTier = 'midrange'
  let profileName = `Mid-Range GPU (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`

  if (!hasGpu || vramGB < 4) {
    profileTier = 'legacy'
    profileName = `Legacy / CPU-Only Hardware (${vramGB > 0 ? `${vramGB}GB VRAM` : 'No GPU'} / ${systemRamGB}GB RAM)`
  } else if (vramGB >= 4 && vramGB < 8) {
    profileTier = 'entry'
    profileName = `Entry-Level GPU (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
  } else if (vramGB >= 8 && vramGB < 12) {
    profileTier = 'midrange'
    profileName = `Mid-Range GPU (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
  } else if (vramGB >= 12 && vramGB < 20) {
    profileTier = 'highend'
    profileName = `High-End Performance GPU (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
  } else {
    profileTier = 'extreme'
    profileName = `Extreme Workstation (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
  }

  const gpuSummary = hasGpu
    ? `${diagnostics?.gpu.gpuName || 'NVIDIA GPU'} (${vramGB} GB VRAM — Safe Budget: ${safeVramBudgetGB.toFixed(1)} GB)`
    : 'No Dedicated GPU Detected (CPU Execution)'
  const ramSummary = `${systemRamGB} GB System RAM`

  const enrich = (item: {
    modelName: string
    displayName: string
    family: string
    sizeBytesApprox: string
    description: string
    isRecommended: boolean
  }): ModelRecommendation => {
    const assessment = assessModelHardwareCompatibility(item.modelName, vramTotalMB, systemRamGB)
    return {
      ...item,
      footprintGB: assessment.footprintGB,
      isHardwareCompatible: assessment.isCompatible,
      compatibilityStatus: assessment.compatibilityStatus,
      compatibilityWarning: assessment.warning,
    }
  }

  // 🟢 Fast Tier Recommendations (Lightweight models: 1B - 3B)
  const rawFastTierModels = [
    {
      modelName: 'qwen2.5-coder:1.5b',
      displayName: 'Qwen 2.5 Coder (1.5B)',
      family: 'qwen-coder',
      sizeBytesApprox: '1.1 GB',
      description: 'Ultra-fast code completion with minimal memory footprint & rapid token response',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange',
    },
    {
      modelName: 'qwen2.5-coder:1.5b-instruct-q8_0',
      displayName: 'Qwen 2.5 Coder (1.5B Q8_0)',
      family: 'qwen-coder',
      sizeBytesApprox: '1.6 GB',
      description: 'High-precision 8-bit quantized fast coding model',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:3b',
      displayName: 'Qwen 2.5 Coder (3B)',
      family: 'qwen-coder',
      sizeBytesApprox: '1.9 GB',
      description: 'Compact high-accuracy code assistant for rapid editing & small refactors',
      isRecommended: profileTier === 'highend' || profileTier === 'extreme',
    },
    {
      modelName: 'qwen2.5-coder:3b-instruct-q4_k_m',
      displayName: 'Qwen 2.5 Coder (3B Q4_K_M)',
      family: 'qwen-coder',
      sizeBytesApprox: '1.8 GB',
      description: 'Quantized compact code assistant for fast edits',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:0.5b',
      displayName: 'Qwen 2.5 Coder (0.5B)',
      family: 'qwen-coder',
      sizeBytesApprox: '400 MB',
      description: 'Ultra-compact micro model for background helper tasks & zero memory pressure',
      isRecommended: false,
    },
    {
      modelName: 'llama3.2:1b',
      displayName: 'Llama 3.2 (1B)',
      family: 'llama',
      sizeBytesApprox: '1.3 GB',
      description: 'Minimal footprint model for ultra low-spec hardware and background helpers',
      isRecommended: false,
    },
    {
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Balanced lightweight model for quick lookups, doc inspection & rapid editing',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5:1.5b',
      displayName: 'Qwen 2.5 (1.5B)',
      family: 'qwen',
      sizeBytesApprox: '1.0 GB',
      description: 'Fast Alibaba lightweight instruction model for concise task routing',
      isRecommended: false,
    },
  ]

  // 🔵 Standard Tier Recommendations (Balanced workhorse models: 3B - 14B)
  const rawStandardTierModels = [
    {
      modelName: 'qwen2.5-coder:7b',
      displayName: 'Qwen 2.5 Coder (7B)',
      family: 'qwen-coder',
      sizeBytesApprox: '4.7 GB',
      description: 'State-of-the-art coding workhorse with high JSON precision & tool calling support',
      isRecommended: profileTier === 'midrange' || profileTier === 'highend',
    },
    {
      modelName: 'qwen2.5-coder:7b-instruct-q4_k_m',
      displayName: 'Qwen 2.5 Coder (7B Q4_K_M)',
      family: 'qwen-coder',
      sizeBytesApprox: '4.4 GB',
      description: 'Quantized 7B coding workhorse offering optimal VRAM headroom on 8GB GPUs',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:7b-instruct-q5_k_m',
      displayName: 'Qwen 2.5 Coder (7B Q5_K_M)',
      family: 'qwen-coder',
      sizeBytesApprox: '5.1 GB',
      description: 'High-precision 5-bit quantized coding workhorse',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:3b',
      displayName: 'Qwen 2.5 Coder (3B)',
      family: 'qwen-coder',
      sizeBytesApprox: '1.9 GB',
      description: 'Balanced low-VRAM coding assistant preserving full headroom on 4-6GB GPUs or CPU',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry',
    },
    {
      modelName: 'qwen2.5-coder:14b',
      displayName: 'Qwen 2.5 Coder (14B)',
      family: 'qwen-coder',
      sizeBytesApprox: '9.0 GB',
      description: 'Large-scale coding model for architectural refactoring and multi-file workflows',
      isRecommended: profileTier === 'extreme',
    },
    {
      modelName: 'qwen2.5-coder:14b-instruct-q4_k_m',
      displayName: 'Qwen 2.5 Coder (14B Q4_K_M)',
      family: 'qwen-coder',
      sizeBytesApprox: '8.9 GB',
      description: 'Quantized 14B coding model for high-end GPUs',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-coder:6.7b',
      displayName: 'DeepSeek Coder (6.7B)',
      family: 'deepseek',
      sizeBytesApprox: '3.8 GB',
      description: 'DeepSeek specialized code generation model with low VRAM requirement',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-coder:6.7b-instruct-q4_k_m',
      displayName: 'DeepSeek Coder (6.7B Q4_K_M)',
      family: 'deepseek',
      sizeBytesApprox: '3.8 GB',
      description: 'Quantized DeepSeek code model for reliable generation',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-coder-v2:16b-lite-instruct-q4_k_m',
      displayName: 'DeepSeek Coder V2 Lite (16B Q4_K_M)',
      family: 'deepseek',
      sizeBytesApprox: '8.9 GB',
      description: 'MoE coding architecture with 236 programming languages support',
      isRecommended: false,
    },
    {
      modelName: 'codestral:22b-v0.1-q4_k_m',
      displayName: 'Mistral Codestral (22B Q4_K_M)',
      family: 'mistral',
      sizeBytesApprox: '13.0 GB',
      description: 'Mistral enterprise code intelligence model (32k context)',
      isRecommended: false,
    },
    {
      modelName: 'starcoder2:7b',
      displayName: 'StarCoder 2 (7B)',
      family: 'starcoder',
      sizeBytesApprox: '4.4 GB',
      description: 'BigCode open-access code generation assistant',
      isRecommended: false,
    },
    {
      modelName: 'codellama:7b-instruct-q4_k_m',
      displayName: 'Code Llama (7B Q4_K_M)',
      family: 'codellama',
      sizeBytesApprox: '4.0 GB',
      description: 'Meta Code Llama specialized Python & C++ model',
      isRecommended: false,
    },
    {
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Balanced low-memory fallback model for CPU/Legacy systems',
      isRecommended: false,
    },
  ]

  // 🟣 Deep Reasoning Tier Recommendations (Multi-step reasoning & architecture)
  const rawDeepReasoningTierModels = [
    {
      modelName: 'qwen2.5-coder:7b',
      displayName: 'Qwen 2.5 Coder (7B)',
      family: 'qwen-coder',
      sizeBytesApprox: '4.7 GB',
      description: 'High-capability coding assistant for deep logic, multi-step refactors & debugging',
      isRecommended: profileTier === 'midrange',
    },
    {
      modelName: 'deepseek-r1:7b',
      displayName: 'DeepSeek R1 Distill Qwen (7B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '4.7 GB',
      description: 'Qwen 2.5-Coder/Math distilled reasoning model for deep algorithmic problem solving',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-r1:7b-qwen-distill-q4_k_m',
      displayName: 'DeepSeek R1 Distill Qwen (7B Q4_K_M)',
      family: 'deepseek-r1',
      sizeBytesApprox: '4.4 GB',
      description: 'Quantized Qwen-distilled reasoning model with low VRAM footprint',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:14b',
      displayName: 'Qwen 2.5 Coder (14B)',
      family: 'qwen-coder',
      sizeBytesApprox: '9.0 GB',
      description: 'Large-scale code intelligence for multi-file architecture refactors',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'deepseek-r1:14b',
      displayName: 'DeepSeek R1 Distill Qwen (14B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '9.2 GB',
      description: 'High-capacity 14B Qwen-distilled reasoning engine for complex system design',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-r1:14b-qwen-distill-q4_k_m',
      displayName: 'DeepSeek R1 Distill Qwen (14B Q4_K_M)',
      family: 'deepseek-r1',
      sizeBytesApprox: '9.0 GB',
      description: 'Quantized 14B deep reasoning engine for 12GB+ GPUs',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:32b',
      displayName: 'Qwen 2.5 Coder (32B)',
      family: 'qwen-coder',
      sizeBytesApprox: '20.0 GB',
      description: 'Premier 32B coding model rivaling proprietary models on complex codebases',
      isRecommended: profileTier === 'extreme',
    },
    {
      modelName: 'deepseek-r1:32b',
      displayName: 'DeepSeek R1 Distill Qwen (32B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '20.0 GB',
      description: 'Ultra-scale 32B reasoning model for exhaustive multi-file code synthesis',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-coder-v2:16b-lite-instruct-q4_k_m',
      displayName: 'DeepSeek Coder V2 Lite (16B Q4_K_M)',
      family: 'deepseek',
      sizeBytesApprox: '8.9 GB',
      description: 'MoE code reasoning engine with 236 programming languages support',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-coder:6.7b',
      displayName: 'DeepSeek Coder (6.7B)',
      family: 'deepseek',
      sizeBytesApprox: '3.8 GB',
      description: 'Specialized coding model for entry-level and legacy GPU hardware',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry',
    },
    {
      modelName: 'qwen2.5-coder:3b',
      displayName: 'Qwen 2.5 Coder (3B)',
      family: 'qwen-coder',
      sizeBytesApprox: '1.9 GB',
      description: 'Compact code model for low-VRAM devices with rapid reasoning',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-r1:8b',
      displayName: 'DeepSeek R1 Distill Llama (8B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '4.9 GB',
      description: 'Llama 3.1-8B distilled reasoning model for 12GB+ GPUs',
      isRecommended: false,
    },
    {
      modelName: 'phi4:14b',
      displayName: 'Microsoft Phi-4 (14B)',
      family: 'phi',
      sizeBytesApprox: '9.1 GB',
      description: 'Microsoft state-of-the-art synthetic reasoning & algorithmic assistant',
      isRecommended: false,
    },
    {
      modelName: 'codestral:22b-v0.1-q4_k_m',
      displayName: 'Mistral Codestral (22B Q4_K_M)',
      family: 'mistral',
      sizeBytesApprox: '13.0 GB',
      description: 'High-capacity code intelligence engine for complex software design',
      isRecommended: false,
    },
  ]

  // 💬 General / RAG Chat Models
  const rawChatTierModels = [
    {
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Fast responsive conversational assistant for low-spec, 8GB GPUs or CPU systems',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange',
    },
    {
      modelName: 'llama3.1:8b',
      displayName: 'Llama 3.1 (8B)',
      family: 'llama',
      sizeBytesApprox: '4.9 GB',
      description: 'Meta 8B balanced conversational assistant for 12GB+ GPUs and multi-document RAG',
      isRecommended: profileTier === 'highend' || profileTier === 'extreme',
    },
    {
      modelName: 'qwen2.5:7b',
      displayName: 'Qwen 2.5 (7B)',
      family: 'qwen',
      sizeBytesApprox: '4.7 GB',
      description: 'High-intelligence multilingual conversational model with strong factual recall',
      isRecommended: false,
    },
    {
      modelName: 'mistral:7b',
      displayName: 'Mistral (7B)',
      family: 'mistral',
      sizeBytesApprox: '4.1 GB',
      description: 'High-speed instruction model for RAG and factual Q&A',
      isRecommended: false,
    },
    {
      modelName: 'gemma2:9b',
      displayName: 'Gemma 2 (9B)',
      family: 'gemma',
      sizeBytesApprox: '5.5 GB',
      description: 'Google Gemma 2 high-precision conversational assistant',
      isRecommended: false,
    },
  ]

  // 🌐 Document Translation Models
  const rawTranslationTierModels = [
    {
      modelName: 'qwen2.5:3b',
      displayName: 'Qwen 2.5 (3B)',
      family: 'qwen',
      sizeBytesApprox: '1.9 GB',
      description: 'High-efficiency multilingual translation preserving layout without VRAM pressure',
      isRecommended: profileTier === 'midrange',
    },
    {
      modelName: 'qwen2.5:1.5b',
      displayName: 'Qwen 2.5 (1.5B)',
      family: 'qwen',
      sizeBytesApprox: '1.0 GB',
      description: 'Lightweight multilingual translation engine for CPU & entry-level GPU systems',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry',
    },
    {
      modelName: 'qwen2.5:7b',
      displayName: 'Qwen 2.5 (7B)',
      family: 'qwen',
      sizeBytesApprox: '4.7 GB',
      description: 'Premier multilingual translation engine for 12GB+ GPUs preserving format',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'aya-expanse:8b',
      displayName: 'Aya Expanse (8B)',
      family: 'cohere',
      sizeBytesApprox: '5.1 GB',
      description: 'Cohere highly-aligned multilingual translation and cross-lingual model',
      isRecommended: profileTier === 'extreme',
    },
    {
      modelName: 'gemma2:2b',
      displayName: 'Google Gemma 2 (2B)',
      family: 'gemma',
      sizeBytesApprox: '1.6 GB',
      description: 'Ultra-lightweight fast multilingual translation model for low-spec systems',
      isRecommended: false,
    },
    {
      modelName: 'gemma2:9b',
      displayName: 'Google Gemma 2 (9B)',
      family: 'gemma',
      sizeBytesApprox: '5.5 GB',
      description: 'High-fidelity multilingual translation model for complex documents',
      isRecommended: false,
    },
    {
      modelName: 'mistral:7b',
      displayName: 'Mistral (7B)',
      family: 'mistral',
      sizeBytesApprox: '4.1 GB',
      description: 'European high-speed instruction model for document translation',
      isRecommended: false,
    },
  ]

  // 👁️ Vision Tier Recommendations
  const rawVisionTierModels = [
    {
      modelName: 'moondream:latest',
      displayName: 'Moondream 2 (1.8B)',
      family: 'moondream',
      sizeBytesApprox: '1.7 GB',
      description: 'Compact fast vision model with minimal footprint for CPU, 4GB and 8GB GPU hardware',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange',
    },
    {
      modelName: 'llava:7b',
      displayName: 'LLaVA (7B)',
      family: 'llava',
      sizeBytesApprox: '4.5 GB',
      description: 'Standard vision-language assistant model for general image & OCR inspection on 12GB+ GPUs',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'llama3.2-vision:11b',
      displayName: 'Llama 3.2 Vision (11B)',
      family: 'llama-vision',
      sizeBytesApprox: '7.9 GB',
      description: 'Meta multimodal model for diagram, table & page layout OCR/inspection',
      isRecommended: profileTier === 'extreme',
    },
    {
      modelName: 'minicpm-v:8b',
      displayName: 'MiniCPM-V (8B)',
      family: 'minicpm',
      sizeBytesApprox: '5.5 GB',
      description: 'High-efficiency multimodal OCR & document layout vision model',
      isRecommended: false,
    },
  ]

  // 🧠 Vector Embedding Tier Recommendations
  const rawEmbeddingTierModels = [
    {
      modelName: 'nomic-embed-text:latest',
      displayName: 'Nomic Embed Text (768-dim)',
      family: 'nomic',
      sizeBytesApprox: '274 MB',
      description: 'Standard high-recall embedding model for LanceDB vector search',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange',
    },
    {
      modelName: 'bge-m3:latest',
      displayName: 'BAAI BGE-M3 (Multilingual 1024d)',
      family: 'bge',
      sizeBytesApprox: '1.1 GB',
      description: 'Multilingual dense & sparse embedding model for enterprise search',
      isRecommended: profileTier === 'highend' || profileTier === 'extreme',
    },
    {
      modelName: 'snowflake-arctic-embed:latest',
      displayName: 'Snowflake Arctic Embed (1024d)',
      family: 'snowflake',
      sizeBytesApprox: '600 MB',
      description: 'High-density multi-lingual retrieval embedding model',
      isRecommended: false,
    },
    {
      modelName: 'mxbai-embed-large:latest',
      displayName: 'MixedBread mxbai-embed-large',
      family: 'mxbai',
      sizeBytesApprox: '670 MB',
      description: 'Large high-density vector embedding model',
      isRecommended: false,
    },
    {
      modelName: 'all-minilm:latest',
      displayName: 'All-MiniLM-L6-v2',
      family: 'minilm',
      sizeBytesApprox: '120 MB',
      description: 'Ultra-fast compact sentence embedding model for lightweight CPU systems',
      isRecommended: false,
    },
  ]

  // 🏥 Medical & Healthcare Domain Models
  const rawMedicalTierModels = [
    {
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Lightweight biomedical and clinical terminology assistant for 4GB-8GB GPUs',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange',
    },
    {
      modelName: 'adrienbrault/biomistral-7b:Q4_K_M',
      displayName: 'BioMistral (7B Q4_K_M)',
      family: 'biomistral',
      sizeBytesApprox: '4.1 GB',
      description: 'Specialized biomedical QA, clinical pharmacology & PubMed evidence for 12GB+ GPUs',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'meditron:7b',
      displayName: 'Meditron (7B)',
      family: 'meditron',
      sizeBytesApprox: '4.3 GB',
      description: 'Clinical guidelines, PubMed evidence & medical Q&A assistant',
      isRecommended: false,
    },
    {
      modelName: 'meditron:70b',
      displayName: 'Meditron (70B)',
      family: 'meditron',
      sizeBytesApprox: '40.0 GB',
      description: 'Enterprise-grade clinical decision support and nosology consultation',
      isRecommended: profileTier === 'extreme',
    },
    {
      modelName: 'llama3.1:8b',
      displayName: 'Llama 3.1 (8B)',
      family: 'llama',
      sizeBytesApprox: '4.9 GB',
      description: 'Meta 8B balanced model with broad medical and clinical terminology support',
      isRecommended: false,
    },
  ]

  // ⚡ Heavy Escalation Tier (14B+) — Auto-healing fallback for complex multi-file tasks
  const rawHeavyEscalationTierModels = [
    {
      modelName: 'qwen2.5-coder:14b',
      displayName: 'Qwen 2.5 Coder (14B)',
      family: 'qwen-coder',
      sizeBytesApprox: '9.0 GB',
      description: 'Large-scale coding intelligence for complex multi-file refactoring and architecture tasks (12GB+ VRAM)',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'qwen2.5-coder:14b-instruct-q4_k_m',
      displayName: 'Qwen 2.5 Coder (14B Q4_K_M)',
      family: 'qwen-coder',
      sizeBytesApprox: '8.9 GB',
      description: 'Quantized 14B heavy escalation model with reduced VRAM footprint on 12GB GPUs',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-r1:14b',
      displayName: 'DeepSeek R1 Distill Qwen (14B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '9.2 GB',
      description: 'High-capacity 14B Qwen-distilled chain-of-thought reasoning engine for escalated debugging',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-r1:14b-qwen-distill-q4_k_m',
      displayName: 'DeepSeek R1 Distill Qwen (14B Q4_K_M)',
      family: 'deepseek-r1',
      sizeBytesApprox: '9.0 GB',
      description: 'Quantized heavy reasoning model for auto-healing tool loop escalation on 12GB GPUs',
      isRecommended: false,
    },
    {
      modelName: 'codestral:22b-v0.1-q4_k_m',
      displayName: 'Mistral Codestral (22B Q4_K_M)',
      family: 'mistral',
      sizeBytesApprox: '13.0 GB',
      description: 'Enterprise-grade Mistral code intelligence for exhaustive system-wide architecture refactors',
      isRecommended: profileTier === 'extreme',
    },
    {
      modelName: 'qwen2.5-coder:32b',
      displayName: 'Qwen 2.5 Coder (32B)',
      family: 'qwen-coder',
      sizeBytesApprox: '20.0 GB',
      description: 'Premier 32B coding model rivaling proprietary models — requires 24GB+ VRAM workstation',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:32b-instruct-q4_k_m',
      displayName: 'Qwen 2.5 Coder (32B Q4_K_M)',
      family: 'qwen-coder',
      sizeBytesApprox: '19.5 GB',
      description: 'Quantized 32B coding model for extreme workstations and multi-GPU setups',
      isRecommended: false,
    },
  ]

  // ⚖️ Legal & Compliance Domain Models
  const rawLegalTierModels = [
    {
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Lightweight legal contract review & compliance for low-VRAM & 8GB systems',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange',
    },
    {
      modelName: 'llama3.1:8b',
      displayName: 'Llama 3.1 (8B)',
      family: 'llama',
      sizeBytesApprox: '4.9 GB',
      description: 'Statutory compliance, legal drafting & regulatory entity extraction for 12GB+ GPUs',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'mistral:7b',
      displayName: 'Mistral (7B)',
      family: 'mistral',
      sizeBytesApprox: '4.1 GB',
      description: 'Specialized legal analysis, European jurisprudence & contract clause review',
      isRecommended: false,
    },
    {
      modelName: 'command-r:35b',
      displayName: 'Cohere Command R (35B)',
      family: 'cohere',
      sizeBytesApprox: '20.0 GB',
      description: 'Grounded RAG with strict citations, compliance policies & legal synthesis',
      isRecommended: profileTier === 'extreme',
    },
    {
      modelName: 'command-r-plus:104b',
      displayName: 'Cohere Command R+ (104B)',
      family: 'cohere',
      sizeBytesApprox: '60.0 GB',
      description: 'Enterprise legal corpus reasoning, high-precision compliance and contract risk',
      isRecommended: false,
    },
  ]

  return {
    profileTier,
    profileName,
    gpuSummary,
    ramSummary,
    safeVramBudgetGB,
    fastTierModels: rawFastTierModels.map(enrich),
    standardTierModels: rawStandardTierModels.map(enrich),
    deepReasoningTierModels: rawDeepReasoningTierModels.map(enrich),
    heavyEscalationTierModels: rawHeavyEscalationTierModels.map(enrich),
    chatTierModels: rawChatTierModels.map(enrich),
    translationTierModels: rawTranslationTierModels.map(enrich),
    medicalTierModels: rawMedicalTierModels.map(enrich),
    legalTierModels: rawLegalTierModels.map(enrich),
    visionTierModels: rawVisionTierModels.map(enrich),
    embeddingTierModels: rawEmbeddingTierModels.map(enrich),
  }
}

/**
 * Calculates optimal client OS environment variables and setup scripts for Ollama
 * based on declared or detected hardware (GPU VRAM, CPU, RAM).
 */
export function getRecommendedOllamaEnvVars(diagnostics: DiagnosticsData | null): OllamaEnvConfig {
  const hasGpu = !!diagnostics?.gpu?.hasNvidiaGpu
  const vramMB = diagnostics?.gpu?.vramTotalMB || 0
  const vramGB = Math.floor(vramMB / 1024)

  let profileTier: HardwareProfileTier = 'legacy'
  if (hasGpu && vramGB >= 24) profileTier = 'extreme'
  else if (hasGpu && vramGB >= 12) profileTier = 'highend'
  else if (hasGpu && vramGB >= 8) profileTier = 'midrange'
  else if (hasGpu && vramGB >= 4) profileTier = 'entry'
  else profileTier = 'legacy'

  const variables: OllamaEnvVarRecommendation[] = []

  // 1. FLASH ATTENTION
  if (hasGpu) {
    variables.push({
      name: 'OLLAMA_FLASH_ATTENTION',
      value: '1',
      description: 'Abilita Flash Attention per accelerazione hardware GPU',
      rationale: 'Raddoppia il throughput token/s e riduce il consumo di VRAM durante il calcolo dell\'attenzione.',
    })
  } else {
    variables.push({
      name: 'OLLAMA_FLASH_ATTENTION',
      value: '0',
      description: 'Disabilita Flash Attention per esecuzione su sola CPU',
      rationale: 'Ottimizza la pipeline di inferenza standard per processori senza kernel CUDA.',
    })
  }

  // 2. KV CACHE TYPE
  if (profileTier === 'legacy' || profileTier === 'entry') {
    variables.push({
      name: 'OLLAMA_KV_CACHE_TYPE',
      value: 'q8_0',
      description: 'Quantizzazione KV-Cache a 8-bit',
      rationale: 'Dimezza l\'impronta di memoria della cache di contesto (50% risparmio VRAM/RAM).',
    })
  } else if (profileTier === 'midrange') {
    variables.push({
      name: 'OLLAMA_KV_CACHE_TYPE',
      value: 'q8_0',
      description: 'Quantizzazione KV-Cache a 8-bit ottimizzata',
      rationale: 'Garantisce ampio buffer di contesto fino a 16k token senza saturare gli 8GB-12GB di VRAM.',
    })
  } else {
    variables.push({
      name: 'OLLAMA_KV_CACHE_TYPE',
      value: 'f16',
      description: 'KV-Cache in precisione Float16',
      rationale: 'Massima fedeltà e precisione per schede grafiche con 16GB-24GB+ VRAM.',
    })
  }

  // 3. NUM PARALLEL
  if (profileTier === 'legacy' || profileTier === 'entry') {
    variables.push({
      name: 'OLLAMA_NUM_PARALLEL',
      value: '1',
      description: '1 richiesta di inferenza alla volta',
      rationale: 'Previene picchi improvvisi di memoria e Out-Of-Memory su sistemi con VRAM/RAM contenuta.',
    })
  } else if (profileTier === 'midrange') {
    variables.push({
      name: 'OLLAMA_NUM_PARALLEL',
      value: '2',
      description: '2 richieste concorrenti simultanee',
      rationale: 'Consente esecuzione parallela di embedding/RAG e chat generativa senza rallentamenti.',
    })
  } else {
    variables.push({
      name: 'OLLAMA_NUM_PARALLEL',
      value: '4',
      description: '4 richieste concorrenti simultanee',
      rationale: 'Supporta flussi multi-agente intensivi e tool loop ad alta concorrenza.',
    })
  }

  // 4. MAX LOADED MODELS
  if (profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange') {
    variables.push({
      name: 'OLLAMA_MAX_LOADED_MODELS',
      value: '1',
      description: '1 modello caricato contemporaneamente in memoria',
      rationale: 'Scarica automaticamente il modello precedente per riservare il 100% della VRAM al modello attivo.',
    })
  } else if (profileTier === 'highend') {
    variables.push({
      name: 'OLLAMA_MAX_LOADED_MODELS',
      value: '2',
      description: '2 modelli caricati in VRAM (es. Embedding + LLM)',
      rationale: 'Commutazione istantanea senza latenza di ricaricamento tra embedding e modello di ragionamento.',
    })
  } else {
    variables.push({
      name: 'OLLAMA_MAX_LOADED_MODELS',
      value: '3',
      description: 'Fino a 3 modelli caldi in VRAM',
      rationale: 'Consente l\'orchestrazione simultanea di Fast, Deep e Embedding model su workstation da 24GB+.',
    })
  }

  // 5. KEEP ALIVE
  if (profileTier === 'legacy') {
    variables.push({
      name: 'OLLAMA_KEEP_ALIVE',
      value: '5m',
      description: 'Timeout di scaricamento modello: 5 minuti',
      rationale: 'Libera prontamente la memoria RAM di sistema dopo brevi sessioni di inattività.',
    })
  } else if (profileTier === 'entry' || profileTier === 'midrange') {
    variables.push({
      name: 'OLLAMA_KEEP_ALIVE',
      value: '30m',
      description: 'Timeout di permanenza in VRAM: 30 minuti',
      rationale: 'Evita continue riallocazioni del modello durante le normali sessioni di chat e coding.',
    })
  } else {
    variables.push({
      name: 'OLLAMA_KEEP_ALIVE',
      value: '2h',
      description: 'Timeout prolungato in VRAM: 2 ore',
      rationale: 'Mantiene i modelli caldi e pronti per risposte istantanee.',
    })
  }

  // 6. OLLAMA HOST
  variables.push({
    name: 'OLLAMA_HOST',
    value: '127.0.0.1:11434',
    description: 'Interfaccia di ascolto protetta su localhost',
    rationale: 'Garantisce isolamento di rete e previene esposizioni accidentali su reti locali.',
  })

  // Generate scripts
  const psLines = [
    `# === Configurazione Variabili OS per Ollama (${profileTier.toUpperCase()}) ===`,
    `# Esegui in PowerShell come Utente o Amministratore:`,
    ...variables.map((v) => `[System.Environment]::SetEnvironmentVariable('${v.name}', '${v.value}', 'User')`),
    ``,
    `# Riavvia il servizio/app Ollama per applicare:`,
    `Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama app.exe"`,
  ]

  const bashLines = [
    `# === Configurazione Variabili OS per Ollama (${profileTier.toUpperCase()}) ===`,
    ...variables.map((v) => `export ${v.name}="${v.value}"`),
    `# Aggiungi a ~/.bashrc o ~/.zshrc per renderle persistenti`,
  ]

  return {
    profileTier,
    variables,
    powershellScript: psLines.join('\n'),
    bashScript: bashLines.join('\n'),
  }
}
