import { DiagnosticsData, RunningModelDetails } from '../types'
import { translate } from '../i18n/I18nContext'
import {
  calculateRealUsableVram,
  calculateUsableSystemRamGB,
  classifyHardwareProfileTier,
  type HardwareFacts,
  type HardwareProfileTier,
} from '../../shared/domain/hardware/hardwareProfileTiers'
import {
  COMPACT_CODING_CATALOG,
  WORKHORSE_CODING_CATALOG,
  REASONING_CODING_CATALOG,
  LARGE_CODING_CATALOG,
  CHAT_TIER_CATALOG,
  TRANSLATION_TIER_CATALOG,
  MEDICAL_TIER_CATALOG,
  LEGAL_TIER_CATALOG,
  VISION_TIER_CATALOG,
  EMBEDDING_TIER_CATALOG,
  type RawModelCatalogEntry,
} from '../../shared/domain/hardware/hardwareModelCatalog'

export type { HardwareFacts } from '../../shared/domain/hardware/hardwareProfileTiers'
export { estimateModelWeightGB }
import { estimateModelWeightGB } from '../../shared/domain/hardware/modelWeightEstimator'

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

export interface HardwareRecommendations {
  profileTier: HardwareProfileTier
  profileName: string
  gpuSummary: string
  ramSummary: string
  safeVramBudgetGB: number
  /** Coding models assessed for current hardware. */
  codingModels: ModelRecommendation[]
  chatTierModels: ModelRecommendation[]
  translationTierModels: ModelRecommendation[]
  medicalTierModels: ModelRecommendation[]
  legalTierModels: ModelRecommendation[]
  visionTierModels: ModelRecommendation[]
  embeddingTierModels: ModelRecommendation[]
}

/** Approximate memory/disk footprint string for model. */
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

/** Estimates KV-Cache VRAM footprint in GB. */
export function estimateKvCacheMemoryGB(contextTokens: number = 4096, isQuantizedQ8: boolean = true): number {
  const bytesPerElem = isQuantizedQ8 ? 1 : 2
  const bytes = 2 * 32 * 8 * 128 * contextTokens * bytesPerElem
  const gb = bytes / (1024 * 1024 * 1024)
  return Math.round(gb * 100) / 100
}

/** Calculates total model footprint in GB (weights + KV cache + CUDA overhead). */
export function calculateTotalModelFootprintGB(
  modelName: string,
  contextTargetTokens: number = 4096,
  isQuantizedQ8: boolean = true,
  details?: RunningModelDetails,
): number {
  const weightGB = estimateModelWeightGB(modelName, details)
  const kvCacheGB = estimateKvCacheMemoryGB(contextTargetTokens, isQuantizedQ8)
  const cudaRuntimeOverheadGB = 0.25
  const total = weightGB + kvCacheGB + cudaRuntimeOverheadGB
  return Math.round(total * 100) / 100
}

/** Assesses model compatibility against detected hardware VRAM/RAM. */
export function assessModelHardwareCompatibility(
  modelName: string,
  vramTotalMB: number,
  totalRamGB: number,
  contextTargetTokens: number = 4096,
  details?: RunningModelDetails,
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
        warning: translate('services.vramHigh'),
      }
    } else {
      return {
        isCompatible: false,
        footprintGB,
        safeVramBudgetGB,
        compatibilityStatus: 'exceeds_vram',
        warning: translate('services.vramInsufficient'),
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
    warning: translate('services.ramInsufficient'),
  }
}

/** Verdict for a single model on the current host, as shown next to a model choice in the UI. */
export interface ModelFitVerdict {
  compatibilityStatus: 'optimal_vram' | 'tight_vram' | 'exceeds_vram'
  footprintGB: number
}

/** Builds a memoized per-model VRAM verdict lookup for the detected host. */
export function buildModelFitLookup(diagnostics: DiagnosticsData | null): (modelName: string) => ModelFitVerdict {
  const facts = extractHardwareFacts(diagnostics)
  const vramTotalMB = facts.vramTotalMB || 0
  const systemRamGB = facts.systemRamGB || 8
  const cache = new Map<string, ModelFitVerdict>()

  return (modelName: string): ModelFitVerdict => {
    const cached = cache.get(modelName)
    if (cached) return cached

    const assessment = assessModelHardwareCompatibility(modelName, vramTotalMB, systemRamGB, 4096, diagnostics?.ollama.modelDetails?.[modelName])
    const verdict: ModelFitVerdict = {
      compatibilityStatus: assessment.compatibilityStatus,
      footprintGB: assessment.footprintGB,
    }
    cache.set(modelName, verdict)
    return verdict
  }
}

export { isOllamaModelInstalled } from '../../shared/domain/agent/modelTagMatcher'

/**
 * Analyzes detected host hardware and calculates calibrated, non-saturated model assignments
 * strictly bound by net usable VRAM budget: VRAM_Disponibile_Reale = (VRAM_Totale * 0.75) - 1.5 GB.
 */
export function analyzeHardwareAndRecommend(diagnostics: DiagnosticsData | null): HardwareRecommendations {
  const { profileTier, profileName, vramTotalMB, systemRamGB, safeVramBudgetGB, gpuSummary, ramSummary } = resolveHardwareProfile(diagnostics)

  const enrich = buildModelEnricher(diagnostics, vramTotalMB, systemRamGB, profileTier)

  return {
    profileTier,
    profileName,
    gpuSummary,
    ramSummary,
    safeVramBudgetGB,
    codingModels: buildCodingModelCatalog().map((item) => enrich(item)),
    chatTierModels: CHAT_TIER_CATALOG.map((item) => enrich(item)),
    translationTierModels: TRANSLATION_TIER_CATALOG.map((item) => enrich(item)),
    medicalTierModels: MEDICAL_TIER_CATALOG.map((item) => enrich(item)),
    legalTierModels: LEGAL_TIER_CATALOG.map((item) => enrich(item)),
    visionTierModels: VISION_TIER_CATALOG.map((item) => enrich(item)),
    embeddingTierModels: EMBEDDING_TIER_CATALOG.map((item) => enrich(item)),
  }
}

/** Detects the host hardware profile tier (legacy/entry/midrange/highend/extreme) from GPU VRAM and system RAM, and derives the safe usable VRAM budget and summary labels used throughout the recommendations (AGT6: extracted from analyzeHardwareAndRecommend to kee */
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

/** Builds the enrichment function that turns a static RawModelCatalogEntry into a fully assessed ModelRecommendation for the current hardware (AGT6: extracted from analyzeHardwareAndRecommend's inline `enrich` closure). */
function buildModelEnricher(diagnostics: DiagnosticsData | null, vramTotalMB: number, systemRamGB: number, profileTier: HardwareProfileTier) {
  return (item: RawModelCatalogEntry): ModelRecommendation => {
    const assessment = assessModelHardwareCompatibility(item.modelName, vramTotalMB, systemRamGB, 4096, diagnostics?.ollama.modelDetails?.[item.modelName])
    const isRecommendedByProfile = item.recommendedForProfiles.includes(profileTier)
    const isRecommended = isRecommendedByProfile

    return {
      modelName: item.modelName,
      displayName: item.displayName,
      family: item.family,
      sizeBytesApprox: item.sizeBytesApprox,
      description: item.description,
      isRecommended,
      footprintGB: assessment.footprintGB,
      isHardwareCompatible: assessment.isCompatible,
      compatibilityStatus: assessment.compatibilityStatus,
      compatibilityWarning: assessment.warning,
    }
  }
}

/** Builds the single coding-model list from the four legacy tier catalogs. */
function buildCodingModelCatalog(): RawModelCatalogEntry[] {
  const byName = new Map<string, RawModelCatalogEntry>()
  const order: string[] = []

  for (const item of WORKHORSE_CODING_CATALOG) {
    if (byName.has(item.modelName)) continue
    byName.set(item.modelName, item)
    order.push(item.modelName)
  }
  for (const item of [...COMPACT_CODING_CATALOG, ...REASONING_CODING_CATALOG, ...LARGE_CODING_CATALOG]) {
    if (byName.has(item.modelName)) continue
    byName.set(item.modelName, { ...item, recommendedForProfiles: [] })
    order.push(item.modelName)
  }

  return order.map((name) => byName.get(name) as RawModelCatalogEntry)
}
