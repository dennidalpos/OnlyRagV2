import { DiagnosticsData, RunningModelDetails } from '../types'
import type { TranslationKey } from '../i18n'
import {
  calculateRealUsableVram,
  calculateUsableSystemRamGB,
  classifyHardwareProfileTier,
  isMinimalHardwareHost,
  VRAM_OVERHEAD_OS_GB,
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

export { calculateRealUsableVram } from '../../shared/domain/hardware/hardwareProfileTiers'
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
  /**
   * Every coding-capable model in the built-in catalogs, deduplicated and hardware-assessed.
   * Replaces the old fast/standard/deep_reasoning/heavy split: the coding module runs on one
   * configured model, so there is one list to choose it from.
   */
  codingModels: ModelRecommendation[]
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
    } else {
      return {
        isCompatible: false,
        footprintGB,
        safeVramBudgetGB,
        compatibilityStatus: 'exceeds_vram',
        warning: 'VRAM insufficiente: rischio elevato di Out-Of-Memory (OOM).',
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

/** Verdict for a single model on the current host, as shown next to a model choice in the UI. */
export interface ModelFitVerdict {
  compatibilityStatus: 'optimal_vram' | 'tight_vram' | 'exceeds_vram'
  footprintGB: number
}

/**
 * Builds a memoized per-model VRAM verdict lookup for the detected host.
 *
 * `analyzeHardwareAndRecommend` only assesses models present in the built-in catalogs, but the
 * Setup Wizard also offers hardcoded preset tags and whatever is already installed locally. This
 * lookup assesses any model name on demand so every selectable option can carry its footprint.
 */
export function buildModelFitLookup(
  diagnostics: DiagnosticsData | null
): (modelName: string) => ModelFitVerdict {
  const facts = extractHardwareFacts(diagnostics)
  const vramTotalMB = facts.vramTotalMB || 0
  const systemRamGB = facts.systemRamGB || 8
  const cache = new Map<string, ModelFitVerdict>()

  return (modelName: string): ModelFitVerdict => {
    const cached = cache.get(modelName)
    if (cached) return cached

    const assessment = assessModelHardwareCompatibility(
      modelName,
      vramTotalMB,
      systemRamGB,
      4096,
      diagnostics?.ollama.modelDetails?.[modelName]
    )
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
export function analyzeHardwareAndRecommend(
  diagnostics: DiagnosticsData | null
): HardwareRecommendations {
  const { profileTier, profileName, vramTotalMB, systemRamGB, safeVramBudgetGB, gpuSummary, ramSummary } =
    resolveHardwareProfile(diagnostics)

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
  return (item: RawModelCatalogEntry): ModelRecommendation => {
    const assessment = assessModelHardwareCompatibility(
      item.modelName,
      vramTotalMB,
      systemRamGB,
      4096,
      diagnostics?.ollama.modelDetails?.[item.modelName]
    )
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

/**
 * Builds the single coding-model list from the four legacy tier catalogs.
 *
 * Only WORKHORSE_CODING_CATALOG carries a meaningful `recommendedForProfiles`: it is the workhorse
 * ladder (legacy/entry -> 3b, midrange/highend -> 7b, extreme -> 14b). The other catalogs tagged
 * profiles RELATIVE to the tier they filled — FAST listed qwen2.5-coder:3b as the pick for
 * 'highend'/'extreme' because it was the *fast* choice on a big machine, not the model that
 * machine should code with. Carrying those tags into one list made a 3b the default on a 24GB
 * workstation, so they are dropped: models outside the ladder stay selectable but are never
 * auto-recommended.
 */
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
