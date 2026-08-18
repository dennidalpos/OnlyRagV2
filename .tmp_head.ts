import { DiagnosticsData, RunningModelDetails } from '../types'
import type { ModelTier } from './complexityRouterService'
import type { TranslationKey } from '../i18n'
import {
  calculateRealUsableVram,
  calculateUsableSystemRamGB,
  classifyHardwareProfileTier,
  isMinimalHardwareHost,
  type HardwareFacts,
  type HardwareProfileTier,
} from './hardwareProfileTiers'
import {
  FAST_TIER_CATALOG,
  STANDARD_TIER_CATALOG,
  DEEP_REASONING_TIER_CATALOG,
  HEAVY_ESCALATION_TIER_CATALOG,
  CHAT_TIER_CATALOG,
  TRANSLATION_TIER_CATALOG,
  MEDICAL_TIER_CATALOG,
  LEGAL_TIER_CATALOG,
  VISION_TIER_CATALOG,
  EMBEDDING_TIER_CATALOG,
  type RawModelCatalogEntry,
} from './hardwareModelCatalog'

// Approximate bytes-per-parameter for common GGUF quantization levels, used to compute
// a model's weight directly from real Ollama metadata (parameter_size, quantization_level)
// when available — see estimateModelWeightGB.
const QUANT_BYTES_PER_PARAM: Record<string, number> = {
  f32: 4, fp32: 4,
  f16: 2, fp16: 2,
  q8_0: 1.06,
  q6_k: 0.82,
  q5_k_m: 0.69, q5_k_s: 0.69, q5_1: 0.69, q5_0: 0.69,
  q4_k_m: 0.60, q4_k_s: 0.60, q4_1: 0.60, q4_0: 0.60,
  q3_k_m: 0.43, q3_k_s: 0.43, q3_k_l: 0.43,
  q2_k: 0.31,
}

const BYTES_PER_GIB = 1024 ** 3
const PARAMS_PER_BILLION = 1_000_000_000

/**
 * Computes a model's weight in GB directly from Ollama-reported metadata
 * (parameter_size e.g. "7.6B", quantization_level e.g. "Q4_K_M"), instead of
 * the static lookup table. Returns null when the metadata is missing or unparseable.
 */
function estimateWeightFromMetadata(details: RunningModelDetails): number | null {
  if (!details.parameter_size) return null
  const paramMatch = details.parameter_size.match(/^([\d.]+)\s*([BMK])$/i)
  if (!paramMatch) return null

  const num = parseFloat(paramMatch[1])
  if (isNaN(num) || num <= 0) return null

  const unit = paramMatch[2].toUpperCase()
  const paramCountBillions = unit === 'B' ? num : unit === 'M' ? num / 1000 : num / 1_000_000

  const quantKey = (details.quantization_level || '').toLowerCase()
  const bytesPerParam = QUANT_BYTES_PER_PARAM[quantKey] ?? 0.60 // default: assume ~Q4-class quantization

  const weightGB = (paramCountBillions * PARAMS_PER_BILLION * bytesPerParam) / BYTES_PER_GIB
  return Math.round(weightGB * 100) / 100
}

// Hardware classification now lives in hardwareProfileTiers.ts (single threshold ladder
// shared with the agent runtime resolver and the complexity router). Re-exported here so
// existing importers of this module keep compiling unchanged.
export {
  calculateRealUsableVram,
  calculateUsableSystemRamGB,
  classifyHardwareProfileTier,
  classifyTierFromSafeBudget,
  isMinimalHardwareHost,
  resolveEffectiveTier,
  VRAM_SAFETY_MARGIN,
  VRAM_OVERHEAD_OS_GB,
} from './hardwareProfileTiers'
export type { HardwareProfileTier, DeclaredHardwareProfile, HardwareFacts } from './hardwareProfileTiers'

export interface ModelRecommendation {
  modelName: string
  displayName: string
  family: string
  sizeBytesApprox: string
  description: string
  isRecommended: boolean
  /**
   * Model-routing tier this recommendation belongs to (see ModelTier in
   * complexityEvaluator.ts) — set for the fast/standard/deep_reasoning/heavy
   * groups. Undefined for functional (non-complexity) groups like chat,
   * translation, medical, legal, vision, and embedding.
   */
  tier?: ModelTier
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
export function estimateModelWeightGB(modelName: string, details?: RunningModelDetails): number {
  if (!modelName) return 4.5
  const lower = modelName.toLowerCase().trim()
  if (lower === 'local' || lower === 'none') return 4.5

  // Prefer real Ollama-reported metadata (parameter_size, quantization_level) when available.
  // The static table below remains as a fallback for models that haven't been queried yet.
  if (details) {
    const fromMetadata = estimateWeightFromMetadata(details)
    if (fromMetadata !== null && fromMetadata > 0) return fromMetadata
  }

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
export function getModelApproxSize(modelName: string, details?: RunningModelDetails): string | undefined {
  if (!modelName) return undefined
  const lower = modelName.toLowerCase().trim()
  if (lower === 'local' || lower === 'none') return undefined

  const weightGB = estimateModelWeightGB(modelName, details)
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
  isQuantizedQ8: boolean = true,
  details?: RunningModelDetails
): number {
  const weightGB = estimateModelWeightGB(modelName, details)
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
  contextTargetTokens: number = 4096,
  details?: RunningModelDetails
): {
  isCompatible: boolean
  footprintGB: number
  safeVramBudgetGB: number
  compatibilityStatus: 'optimal_vram' | 'tight_vram' | 'exceeds_vram'
  warning?: string
} {
  const footprintGB = calculateTotalModelFootprintGB(modelName, contextTargetTokens, true, details)
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
  const safeRamBudget = calculateUsableSystemRamGB(totalRamGB)
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
  const { profileTier, profileName, vramTotalMB, systemRamGB, safeVramBudgetGB, gpuSummary, ramSummary } =
    resolveHardwareProfile(diagnostics)

  const enrich = buildModelEnricher(diagnostics, vramTotalMB, systemRamGB, profileTier)

  return {
    profileTier,
    profileName,
    gpuSummary,
    ramSummary,
    safeVramBudgetGB,
    fastTierModels: FAST_TIER_CATALOG.map((item) => enrich(item, 'fast')),
    standardTierModels: STANDARD_TIER_CATALOG.map((item) => enrich(item, 'standard')),
    deepReasoningTierModels: DEEP_REASONING_TIER_CATALOG.map((item) => enrich(item, 'deep_reasoning')),
    heavyEscalationTierModels: HEAVY_ESCALATION_TIER_CATALOG.map((item) => enrich(item, 'heavy')),
    chatTierModels: CHAT_TIER_CATALOG.map((item) => enrich(item)),
    translationTierModels: TRANSLATION_TIER_CATALOG.map((item) => enrich(item)),
    medicalTierModels: MEDICAL_TIER_CATALOG.map((item) => enrich(item)),
    legalTierModels: LEGAL_TIER_CATALOG.map((item) => enrich(item)),
    visionTierModels: VISION_TIER_CATALOG.map((item) => enrich(item)),
    embeddingTierModels: EMBEDDING_TIER_CATALOG.map((item) => enrich(item)),
  }
}

/**
 * Detects the host hardware profile tier (legacy/entry/midrange/highend/extreme)
 * from GPU VRAM and system RAM, and derives the safe usable VRAM budget and
 * summary labels used throughout the recommendations (AGT6: extracted from
 * analyzeHardwareAndRecommend to keep it within the project's function-length
 * standard — see AGENTS.md §8).
 */
function resolveHardwareProfile(diagnostics: DiagnosticsData | null): {
  profileTier: HardwareProfileTier
  profileName: string
  vramTotalMB: number
  systemRamGB: number
  safeVramBudgetGB: number
  gpuSummary: string
  ramSummary: string
} {
  const facts = extractHardwareFacts(diagnostics)
  const hasGpu = !!facts.hasGpu
  const vramTotalMB = facts.vramTotalMB || 0
  const vramGB = Math.floor(vramTotalMB / 1024)
  const systemRamGB = facts.systemRamGB || 8
  const safeVramBudgetGB = calculateRealUsableVram(vramTotalMB)

  const profileTier = classifyHardwareProfileTier(facts)
  const profileName = formatProfileName(profileTier, vramGB, systemRamGB)

  const gpuSummary = hasGpu
    ? `${diagnostics?.gpu.gpuName || 'NVIDIA GPU'} (${vramGB} GB VRAM — Safe Budget: ${safeVramBudgetGB.toFixed(1)} GB)`
    : 'No Dedicated GPU Detected (CPU Execution)'
  const ramSummary = `${systemRamGB} GB System RAM`

  return { profileTier, profileName, vramTotalMB, systemRamGB, safeVramBudgetGB, gpuSummary, ramSummary }
}

/**
 * Normalizes a diagnostics snapshot into the raw facts every hardware-aware surface
 * consumes (model matrix, agent runtime options, Ollama OS parameters, chat budgets).
 */
export function extractHardwareFacts(diagnostics: DiagnosticsData | null): HardwareFacts {
  return {
    hasGpu: diagnostics?.gpu.hasNvidiaGpu || false,
    vramTotalMB: diagnostics?.gpu.vramTotalMB || 0,
    systemRamGB: Math.round(diagnostics?.memory.totalRAMGB || 8),
    cpuCount: diagnostics?.system.cpusCount || 0,
  }
}

/** Human-readable label for a classified tier (classification itself lives in hardwareProfileTiers.ts). */
function formatProfileName(tier: HardwareProfileTier, vramGB: number, systemRamGB: number): string {
  const specs = `${vramGB}GB VRAM / ${systemRamGB}GB RAM`
  switch (tier) {
    case 'legacy':
      return `Legacy / CPU-Only Hardware (${vramGB > 0 ? `${vramGB}GB VRAM` : 'No GPU'} / ${systemRamGB}GB RAM)`
    case 'entry':
      return `Entry-Level GPU (${specs})`
    case 'midrange':
      return `Mid-Range GPU (${specs})`
    case 'highend':
      return `High-End Performance GPU (${specs})`
    default:
      return `Extreme Workstation (${specs})`
  }
}

/**
 * Builds the enrichment function that turns a static RawModelCatalogEntry into a
 * fully assessed ModelRecommendation for the current hardware (AGT6: extracted
 * from analyzeHardwareAndRecommend's inline `enrich` closure).
 */
function buildModelEnricher(
  diagnostics: DiagnosticsData | null,
  vramTotalMB: number,
  systemRamGB: number,
  profileTier: HardwareProfileTier
) {
  return (item: RawModelCatalogEntry, tier?: ModelTier): ModelRecommendation => {
    const assessment = assessModelHardwareCompatibility(
      item.modelName,
      vramTotalMB,
      systemRamGB,
      4096,
      diagnostics?.ollama.modelDetails?.[item.modelName]
    )
    return {
      modelName: item.modelName,
      displayName: item.displayName,
      family: item.family,
      sizeBytesApprox: item.sizeBytesApprox,
      description: item.description,
      isRecommended: item.recommendedForProfiles.includes(profileTier),
      tier,
      footprintGB: assessment.footprintGB,
      isHardwareCompatible: assessment.isCompatible,
      compatibilityStatus: assessment.compatibilityStatus,
      compatibilityWarning: assessment.warning,
    }
  }
}
