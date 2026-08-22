import { DiagnosticsData, RunningModelDetails } from '../types'
import type { ModelTier } from './complexityRouterService'
import type { TranslationKey } from '../i18n'
import {
  calculateRealUsableVram,
  calculateUsableSystemRamGB,
  classifyHardwareProfileTier,
  isMinimalHardwareHost,
  VRAM_OVERHEAD_OS_GB,
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
  parseCatalogSizeGB,
  type RawModelCatalogEntry,
} from './hardwareModelCatalog'

// Every catalog model's weight is derived directly from its own `sizeBytesApprox` instead of
// a hand-maintained duplicate: the two used to be kept in sync only by convention and a test
// (hardwareRecommendationEngine.test.ts > 'should keep every catalog entry priced consistently
// with its advertised size'), so a catalog change silently drifted from its price table entry
// until that test caught it. Only non-catalog aliases (quantization-variant shortcuts and
// third-party tags a user may have pulled locally outside the curated catalog) need an
// explicit entry in `KNOWN_WEIGHT_ALIASES_GB` below.
const CATALOG_DERIVED_WEIGHTS_GB: Record<string, number> = Object.fromEntries(
  ([
    ...FAST_TIER_CATALOG,
    ...STANDARD_TIER_CATALOG,
    ...DEEP_REASONING_TIER_CATALOG,
    ...HEAVY_ESCALATION_TIER_CATALOG,
    ...CHAT_TIER_CATALOG,
    ...TRANSLATION_TIER_CATALOG,
    ...MEDICAL_TIER_CATALOG,
    ...LEGAL_TIER_CATALOG,
    ...VISION_TIER_CATALOG,
    ...EMBEDDING_TIER_CATALOG,
  ] as RawModelCatalogEntry[]).map((entry) => [
    entry.modelName.toLowerCase(),
    parseCatalogSizeGB(entry.sizeBytesApprox),
  ])
)

const KNOWN_WEIGHT_ALIASES_GB: Record<string, number> = {
  'all-minilm': 0.12,
  'nomic-embed-text': 0.27,
  'snowflake-arctic-embed': 0.6,
  'mxbai-embed-large': 0.67,
  'bge-m3': 1.1,
  'qwen2.5-coder:1.5b-instruct-q4_k_m': 1.0,
  'moondream': 1.7,
  'qwen2.5-coder:3b-instruct-q8_0': 3.2,
  'starcoder2:3b': 2.0,
  'phi3.5:3.8b': 2.2,
  'deepseek-coder:6.7b-instruct-q8_0': 7.2,
  'codellama:7b': 4.2,
  'adrienbrault/biomistral-7b': 4.1,
  'qwen2.5-coder:7b-instruct-q8_0': 7.6,
  'deepseek-r1:8b-llama-distill-q4_k_m': 4.9,
  'command-r7b': 5.1,
  'codellama:13b': 7.8,
  'solar:10.7b': 6.8,
  'deepseek-coder-v2:16b-lite-instruct-q5_k_m': 10.5,
  'deepseek-coder-v2:16b': 8.9,
  'qwen2.5-coder:14b-instruct-q5_k_m': 10.3,
  'qwen2.5-coder:14b-instruct-q8_0': 15.0,
  'qwen2.5:14b': 9.0,
  'phi4:14b-q4_k_m': 9.1,
  'codestral:22b': 13.0,
  'codestral:22b-v0.1-q5_k_m': 15.5,
  'codellama:34b': 20.0,
  'gpt-oss:120b': 65.0,
}

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
  if (lower.includes('qwen2.5vl') || lower.includes('qwen-vl') || lower.includes('qwen2vl')) return 'qwen-vl'
  if (/qwen[\d.]*-coder/.test(lower) || lower.includes('qwen-coder')) return 'qwen-coder'
  if (lower.includes('qwen')) return 'qwen'
  if (lower.includes('llama3.2-vision') || lower.includes('llama-vision')) return 'llama-vision'
  if (lower.includes('llama')) return 'llama'
  if (lower.includes('deepseek-r1')) return 'deepseek-r1'
  if (lower.includes('deepseek')) return 'deepseek'
  if (lower.includes('mistral') || lower.includes('codestral') || lower.includes('devstral')) return 'mistral'
  if (lower.includes('gpt-oss')) return 'gpt-oss'
  if (lower.includes('granite')) return 'granite'
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
    ...CATALOG_DERIVED_WEIGHTS_GB,
    ...KNOWN_WEIGHT_ALIASES_GB,
  }

  // Most-specific-key-wins resolution. A plain insertion-order scan let a SHORTER key
  // shadow the exact entry for a longer tag: 'qwen2.5-coder:1.5b' is declared before
  // 'qwen2.5-coder:1.5b-instruct-q8_0', so the q8_0 variant resolved to 1.1 GB instead of
  // its real 1.6 GB — a systematic under-count of VRAM for every quantized variant, which
  // is precisely the direction that causes an OOM rather than a wasted reserve.
  if (knownWeightsGB[lower] !== undefined) return knownWeightsGB[lower]

  const keys = Object.keys(knownWeightsGB)

  // Tag extends a known base (e.g. 'bge-m3:some-new-tag' -> 'bge-m3'): longest base wins.
  let bestPrefix = ''
  for (const key of keys) {
    if (lower.startsWith(key) && key.length > bestPrefix.length) bestPrefix = key
  }
  if (bestPrefix) return knownWeightsGB[bestPrefix]

  // Tag is a truncation of a known key (e.g. 'moondream' -> 'moondream:latest'): the
  // shortest such key is the nearest relative.
  let bestExtension = ''
  for (const key of keys) {
    if (key.startsWith(lower) && (!bestExtension || key.length < bestExtension.length)) bestExtension = key
  }
  if (bestExtension) return knownWeightsGB[bestExtension]

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
  details?: RunningModelDetails,
  enableSystemRamOffloading: boolean = false
): {
  isCompatible: boolean
  footprintGB: number
  safeVramBudgetGB: number
  compatibilityStatus: 'optimal_vram' | 'tight_vram' | 'exceeds_vram'
  warning?: string
} {
  const footprintGB = calculateTotalModelFootprintGB(modelName, contextTargetTokens, true, details)
  const safeVramBudgetGB = calculateRealUsableVram(vramTotalMB)
  const safeRamBudget = calculateUsableSystemRamGB(totalRamGB)
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
    } else if (enableSystemRamOffloading && footprintGB <= safeVramBudgetGB + safeRamBudget) {
      return {
        isCompatible: true,
        footprintGB,
        safeVramBudgetGB,
        compatibilityStatus: 'tight_vram',
        warning: 'Offloading ibrido su RAM di sistema attivo: i layer eccedenti saranno allocati ed eseguiti in RAM.',
      }
    } else {
      return {
        isCompatible: false,
        footprintGB,
        safeVramBudgetGB,
        compatibilityStatus: 'exceeds_vram',
        warning: enableSystemRamOffloading
          ? 'Memoria combinata (VRAM + RAM) insufficiente per eseguire questo modello.'
          : "VRAM insufficiente: rischio elevato di Out-Of-Memory (OOM). Abilita l'Offloading su RAM nelle impostazioni per usare modelli più grandi.",
      }
    }
  }

  // CPU execution / No GPU
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

export { isOllamaModelInstalled } from './complexityRouterService'

/**
 * Analyzes detected host hardware and calculates calibrated, non-saturated model assignments
 * strictly bound by net usable VRAM budget: VRAM_Disponibile_Reale = (VRAM_Totale * 0.75) - 1.5 GB.
 */
export function analyzeHardwareAndRecommend(
  diagnostics: DiagnosticsData | null,
  enableSystemRamOffloading: boolean = false
): HardwareRecommendations {
  const { profileTier, profileName, vramTotalMB, systemRamGB, safeVramBudgetGB, gpuSummary, ramSummary } =
    resolveHardwareProfile(diagnostics)

  const enrich = buildModelEnricher(diagnostics, vramTotalMB, systemRamGB, profileTier, enableSystemRamOffloading)

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
  profileTier: HardwareProfileTier,
  enableSystemRamOffloading: boolean = false
) {
  return (item: RawModelCatalogEntry, tier?: ModelTier): ModelRecommendation => {
    const assessment = assessModelHardwareCompatibility(
      item.modelName,
      vramTotalMB,
      systemRamGB,
      4096,
      diagnostics?.ollama.modelDetails?.[item.modelName],
      enableSystemRamOffloading
    )
    const isRecommendedByProfile = item.recommendedForProfiles.includes(profileTier)
    const isRecommended =
      isRecommendedByProfile ||
      (enableSystemRamOffloading &&
        tier === 'heavy' &&
        assessment.isCompatible &&
        item.recommendedForProfiles.includes('highend'))

    return {
      modelName: item.modelName,
      displayName: item.displayName,
      family: item.family,
      sizeBytesApprox: item.sizeBytesApprox,
      description: item.description,
      isRecommended,
      tier,
      footprintGB: assessment.footprintGB,
      isHardwareCompatible: assessment.isCompatible,
      compatibilityStatus: assessment.compatibilityStatus,
      compatibilityWarning: assessment.warning,
    }
  }
}

/**
 * Per-variable recommendation builders. Kept separate from the assembler below so each
 * variable's hardware reasoning stays readable and independently testable, and so the
 * assembler itself stays within the project's function-length standard (AGENTS.md 8).
 */
type EnvTranslator = (key: TranslationKey, params?: Record<string, string | number>) => string

interface EnvTuningContext {
  profileTier: HardwareProfileTier
  isMinimal: boolean
  hasGpu: boolean
  cpuCount: number
  systemRamGB: number
}

/**
 * Flash Attention and KV-cache quantization are a *pair*: Ollama only honours
 * OLLAMA_KV_CACHE_TYPE when flash attention is enabled. Emitting a cache type on a
 * CPU-only host (where flash attention is off) therefore wrote an inert variable into the
 * user's environment, so the cache type is now only produced for GPU hosts.
 */
function buildAttentionVars(ctx: EnvTuningContext, t: EnvTranslator): OllamaEnvVarRecommendation[] {
  if (!ctx.hasGpu || ctx.profileTier === 'legacy') {
    return [
      {
        name: 'OLLAMA_FLASH_ATTENTION',
        value: '0',
        description: t('ollamaEnvParams.envFlashOffDesc'),
        rationale: t('ollamaEnvParams.envFlashOffRationale'),
      },
    ]
  }

  const kv = ctx.profileTier === 'highend' || ctx.profileTier === 'extreme'
    ? { value: 'f16', descKey: 'ollamaEnvParams.envKvHighDesc', ratKey: 'ollamaEnvParams.envKvHighRationale' }
    : ctx.profileTier === 'midrange'
      ? { value: 'q8_0', descKey: 'ollamaEnvParams.envKvMidDesc', ratKey: 'ollamaEnvParams.envKvMidRationale' }
      : { value: 'q8_0', descKey: 'ollamaEnvParams.envKvLowDesc', ratKey: 'ollamaEnvParams.envKvLowRationale' }

  return [
    {
      name: 'OLLAMA_FLASH_ATTENTION',
      value: '1',
      description: t('ollamaEnvParams.envFlashOnDesc'),
      rationale: t('ollamaEnvParams.envFlashOnRationale'),
    },
    {
      name: 'OLLAMA_KV_CACHE_TYPE',
      value: kv.value,
      description: t(kv.descKey as TranslationKey),
      rationale: t(kv.ratKey as TranslationKey),
    },
    {
      // Mirrors the app's own VRAM_OVERHEAD_OS_GB reserve so Ollama's layer-offload planner
      // budgets the same display/compositor headroom calculateRealUsableVram assumes.
      name: 'OLLAMA_GPU_OVERHEAD',
      value: String(Math.round(VRAM_OVERHEAD_OS_GB * 1024 * 1024 * 1024)),
      description: t('ollamaEnvParams.envGpuOverheadDesc', { gb: VRAM_OVERHEAD_OS_GB.toFixed(1) }),
      rationale: t('ollamaEnvParams.envGpuOverheadRationale'),
    },
  ]
}

/**
 * Concurrency is bounded by BOTH the memory tier and the physical core count: on a CPU-only
 * host every parallel slot competes for the same cores, so extra parallelism is pure latency.
 * Roughly 4 cores are budgeted per concurrent inference slot.
 */
function buildConcurrencyVars(ctx: EnvTuningContext, t: EnvTranslator): OllamaEnvVarRecommendation[] {
  const tierParallel = !ctx.hasGpu || ctx.profileTier === 'legacy' || ctx.profileTier === 'entry'
    ? 1
    : ctx.profileTier === 'midrange'
      ? 2
      : 4
  const coreCap = ctx.cpuCount > 0 ? Math.max(1, Math.floor(ctx.cpuCount / 4)) : 1
  const parallel = Math.min(tierParallel, coreCap)

  const parallelKeys = parallel <= 1
    ? { descKey: 'ollamaEnvParams.envParallelLowDesc', ratKey: 'ollamaEnvParams.envParallelLowRationale' }
    : parallel === 2
      ? { descKey: 'ollamaEnvParams.envParallelMidDesc', ratKey: 'ollamaEnvParams.envParallelMidRationale' }
      : { descKey: 'ollamaEnvParams.envParallelHighDesc', ratKey: 'ollamaEnvParams.envParallelHighRationale' }

  // A second resident model only pays off when there is memory to keep it hot; low-RAM hosts
  // must evict aggressively or the OS starts swapping the KV cache to disk.
  const maxLoaded = ctx.profileTier === 'extreme' && ctx.systemRamGB >= 32
    ? 3
    : ctx.profileTier === 'highend' || ctx.profileTier === 'extreme'
      ? 2
      : 1
  const loadedKeys = maxLoaded >= 3
    ? { descKey: 'ollamaEnvParams.envMaxLoadedExtremeDesc', ratKey: 'ollamaEnvParams.envMaxLoadedExtremeRationale' }
    : maxLoaded === 2
      ? { descKey: 'ollamaEnvParams.envMaxLoadedHighDesc', ratKey: 'ollamaEnvParams.envMaxLoadedHighRationale' }
      : { descKey: 'ollamaEnvParams.envMaxLoadedLowDesc', ratKey: 'ollamaEnvParams.envMaxLoadedLowRationale' }

  return [
    {
      name: 'OLLAMA_NUM_PARALLEL',
      value: String(parallel),
      description: t(parallelKeys.descKey as TranslationKey),
      rationale: t(parallelKeys.ratKey as TranslationKey),
    },
    {
      name: 'OLLAMA_MAX_LOADED_MODELS',
      value: String(maxLoaded),
      description: t(loadedKeys.descKey as TranslationKey),
      rationale: t(loadedKeys.ratKey as TranslationKey),
    },
  ]
}

/**
 * Residency and default context length. OLLAMA_CONTEXT_LENGTH is the server-side default
 * num_ctx used whenever a request omits it - left unset, a minimum-spec host silently
 * allocates a KV cache far larger than its RAM can absorb.
 */
function buildMemoryResidencyVars(ctx: EnvTuningContext, t: EnvTranslator): OllamaEnvVarRecommendation[] {
  const keepAlive = ctx.isMinimal || ctx.profileTier === 'legacy'
    ? { value: '5m', descKey: 'ollamaEnvParams.envKeepAliveLowDesc', ratKey: 'ollamaEnvParams.envKeepAliveLowRationale' }
    : ctx.profileTier === 'entry' || ctx.profileTier === 'midrange'
      ? { value: '30m', descKey: 'ollamaEnvParams.envKeepAliveMidDesc', ratKey: 'ollamaEnvParams.envKeepAliveMidRationale' }
      : { value: '2h', descKey: 'ollamaEnvParams.envKeepAliveHighDesc', ratKey: 'ollamaEnvParams.envKeepAliveHighRationale' }

  const contextLength = ctx.isMinimal
    ? 4096
    : ctx.profileTier === 'legacy' || ctx.profileTier === 'entry' || ctx.profileTier === 'midrange'
      ? 8192
      : ctx.profileTier === 'highend'
        ? 16384
        : 32768
  const contextKeys = contextLength <= 4096
    ? { descKey: 'ollamaEnvParams.envContextLenLowDesc', ratKey: 'ollamaEnvParams.envContextLenLowRationale' }
    : contextLength <= 8192
      ? { descKey: 'ollamaEnvParams.envContextLenMidDesc', ratKey: 'ollamaEnvParams.envContextLenMidRationale' }
      : { descKey: 'ollamaEnvParams.envContextLenHighDesc', ratKey: 'ollamaEnvParams.envContextLenHighRationale' }

  return [
    {
      name: 'OLLAMA_KEEP_ALIVE',
      value: keepAlive.value,
      description: t(keepAlive.descKey as TranslationKey),
      rationale: t(keepAlive.ratKey as TranslationKey),
    },
    {
      name: 'OLLAMA_CONTEXT_LENGTH',
      value: String(contextLength),
      description: t(contextKeys.descKey as TranslationKey, { tokens: contextLength }),
      rationale: t(contextKeys.ratKey as TranslationKey),
    },
  ]
}

/** Renders the copy-paste setup scripts for the resolved variable set. */
function buildEnvScripts(
  profileTier: HardwareProfileTier,
  variables: OllamaEnvVarRecommendation[]
): { powershellScript: string; bashScript: string } {
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

  return { powershellScript: psLines.join('\n'), bashScript: bashLines.join('\n') }
}

/**
 * Calculates optimal client OS environment variables and setup scripts for Ollama based on
 * the FULL detected hardware picture - GPU VRAM, physical core count and system RAM - not
 * VRAM alone: a 4-core / 8GB CPU-only laptop and a 32-core / 64GB CPU-only workstation both
 * classify as `legacy`, yet only the first must clamp concurrency, residency and default
 * context length. `t` defaults to an identity passthrough so non-UI callers (tests, scripts)
 * do not need an i18n context.
 */
export function getRecommendedOllamaEnvVars(
  diagnostics: DiagnosticsData | null,
  t: EnvTranslator = (key) => key
): OllamaEnvConfig {
  const facts = extractHardwareFacts(diagnostics)
  const profileTier = classifyHardwareProfileTier(facts)

  const ctx: EnvTuningContext = {
    profileTier,
    isMinimal: isMinimalHardwareHost(facts),
    hasGpu: !!facts.hasGpu,
    cpuCount: facts.cpuCount || 0,
    systemRamGB: facts.systemRamGB || 8,
  }

  const variables: OllamaEnvVarRecommendation[] = [
    ...buildAttentionVars(ctx, t),
    ...buildConcurrencyVars(ctx, t),
    ...buildMemoryResidencyVars(ctx, t),
    {
      name: 'OLLAMA_HOST',
      value: '127.0.0.1:11434',
      description: t('ollamaEnvParams.envHostDesc'),
      rationale: t('ollamaEnvParams.envHostRationale'),
    },
  ]

  return { profileTier, variables, ...buildEnvScripts(profileTier, variables) }
}
