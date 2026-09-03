import {
  VISION_TIER_CATALOG,
  EMBEDDING_TIER_CATALOG,
  COMPACT_CODING_CATALOG,
  WORKHORSE_CODING_CATALOG,
  REASONING_CODING_CATALOG,
  LARGE_CODING_CATALOG,
  CHAT_TIER_CATALOG,
  TRANSLATION_TIER_CATALOG,
  MEDICAL_TIER_CATALOG,
  LEGAL_TIER_CATALOG,
} from '../../shared/domain/hardware/hardwareModelCatalog'

export type ModelIntent =
  | 'vision'
  | 'embedding'
  | 'coding'
  | 'translation'
  | 'chat'
  | 'medical'
  | 'legal'

/**
 * Normalizes a model tag or name for intent detection (lowercase, stripped whitespace, stripped namespace).
 */
export function normalizeModelNameForIntent(name: string): { normalized: string; baseName: string; tag: string } {
  if (!name || typeof name !== 'string') {
    return { normalized: '', baseName: '', tag: '' }
  }

  const raw = name.trim().toLowerCase()
  let remainder = raw

  if (remainder.includes('/')) {
    remainder = remainder.slice(remainder.indexOf('/') + 1)
  }

  let baseName = remainder
  let tag = ''

  if (remainder.includes(':')) {
    const colonIdx = remainder.indexOf(':')
    baseName = remainder.slice(0, colonIdx)
    tag = remainder.slice(colonIdx + 1)
  }

  return { normalized: raw, baseName, tag }
}

// Sets of catalog model names for O(1) canonical matching
const VISION_CATALOG_FULL_NAMES = new Set(VISION_TIER_CATALOG.map((m) => m.modelName.toLowerCase()))
const EMBEDDING_CATALOG_NAMES = new Set(EMBEDDING_TIER_CATALOG.map((m) => m.modelName.toLowerCase().split(':')[0]))
const CODING_CATALOG_NAMES = new Set([
  ...COMPACT_CODING_CATALOG,
  ...WORKHORSE_CODING_CATALOG,
  ...REASONING_CODING_CATALOG,
  ...LARGE_CODING_CATALOG,
].map((m) => m.modelName.toLowerCase().split(':')[0]))
const CHAT_CATALOG_NAMES = new Set(CHAT_TIER_CATALOG.map((m) => m.modelName.toLowerCase().split(':')[0]))
const TRANSLATION_CATALOG_NAMES = new Set(TRANSLATION_TIER_CATALOG.map((m) => m.modelName.toLowerCase().split(':')[0]))
const MEDICAL_CATALOG_NAMES = new Set(MEDICAL_TIER_CATALOG.map((m) => m.modelName.toLowerCase().split(':')[0]))
const LEGAL_CATALOG_NAMES = new Set(LEGAL_TIER_CATALOG.map((m) => m.modelName.toLowerCase().split(':')[0]))

/**
 * Determines if a model is a Vision-Language / Multimodal model capable of processing images in Ollama.
 * Matches: llama3.2-vision, minicpm-v, llava, moondream, qwen2-vl, qwen2.5-vl, gemma3:4b/12b/27b, bakllava, etc.
 * Explicitly EXCLUDES text-only LLMs and embedding models.
 */
export function isVisionModel(name: string): boolean {
  if (!name) return false
  const { normalized, baseName, tag } = normalizeModelNameForIntent(name)
  if (!normalized) return false

  // If it's an embedding model, it cannot be vision
  if (isEmbeddingModel(name)) return false

  // Exact catalog vision model name
  if (VISION_CATALOG_FULL_NAMES.has(normalized)) return true

  // Pure vision-only base families
  const pureVisionFamilies = new Set([
    'moondream',
    'llava',
    'bakllava',
    'minicpm-v',
    'llama3.2-vision',
    'llama-vision',
    'qwen2.5vl',
    'qwen2-vl',
    'qwen-vl',
    'paligemma',
    'florence',
    'cogvlm',
    'internvl',
  ])
  if (pureVisionFamilies.has(baseName)) return true

  // Vision keyword patterns in model name or tag
  const visionPatterns = [
    /llama-?vision/i,
    /llama3\.2-vision/i,
    /llava/i,
    /moondream/i,
    /minicpm-?v/i,
    /qwen.*-?vl/i,
    /qwen.*vl/i,
    /bakllava/i,
    /phi3-?vision/i,
    /phi3\.5-?vision/i,
    /phi4-?multimodal/i,
    /yi-?vl/i,
    /internvl/i,
    /deepseek-?vl/i,
    /granite-?vision/i,
    /paligemma/i,
    /florence/i,
    /cogvlm/i,
    /xcomposer/i,
    /-vl\b/i,
    /\bvl:/i,
    /vision\b/i,
    /multimodal/i,
  ]

  for (const pattern of visionPatterns) {
    if (pattern.test(normalized) || pattern.test(baseName) || pattern.test(tag)) {
      return true
    }
  }

  // Google Gemma 3: Gemma 3 has multimodal capabilities on sizes >= 4B (4b, 12b, 27b)
  if (baseName === 'gemma3' || baseName.startsWith('gemma3:')) {
    const sizeMatch = (tag || normalized).match(/^(\d+)b/i)
    if (sizeMatch) {
      const sizeB = parseInt(sizeMatch[1], 10)
      if (sizeB >= 4) return true
    }
  }

  return false
}

/**
 * Determines if a model is a Vector Embedding model.
 * Matches: nomic-embed-text, bge-m3, all-minilm, mxbai-embed-large, snowflake-arctic-embed, embeddinggemma, etc.
 */
export function isEmbeddingModel(name: string): boolean {
  if (!name) return false
  const { normalized, baseName } = normalizeModelNameForIntent(name)
  if (!normalized) return false

  if (EMBEDDING_CATALOG_NAMES.has(baseName)) return true

  const embeddingPatterns = [
    /embed/i,
    /embedding/i,
    /bge-/i,
    /bge\b/i,
    /nomic-embed/i,
    /all-minilm/i,
    /minilm/i,
    /mxbai-embed/i,
    /snowflake-arctic-embed/i,
    /paraphrase/i,
    /\be5-/i,
    /gte-/i,
    /text-embedding/i,
  ]

  for (const pattern of embeddingPatterns) {
    if (pattern.test(normalized) || pattern.test(baseName)) {
      return true
    }
  }

  return false
}

/**
 * Determines if a model is suitable for the AI Coding Agent Studio.
 * Matches coding-specialized models (qwen2.5-coder, codestral, deepseek-coder, etc.)
 * as well as strong general-purpose reasoning models (qwen2.5, qwen3, deepseek-r1, llama3.1, mistral, etc.).
 * Strictly excludes pure embedding models and pure vision-only models.
 */
export function isCodingModel(name: string): boolean {
  if (!name) return false
  if (isEmbeddingModel(name)) return false
  if (isVisionModel(name)) return false

  const { normalized, baseName } = normalizeModelNameForIntent(name)
  if (!normalized) return false

  if (CODING_CATALOG_NAMES.has(baseName)) return true

  const codePatterns = [
    /coder/i,
    /codestral/i,
    /starcoder/i,
    /codeqwen/i,
    /codellama/i,
    /codegemma/i,
    /granite-code/i,
    /codegeex/i,
    /wizardcoder/i,
    /magicoder/i,
    /\bcode\b/i,
    /-code\b/i,
    /code-/i,
  ]

  for (const pattern of codePatterns) {
    if (pattern.test(normalized) || pattern.test(baseName)) {
      return true
    }
  }

  // General high-reasoning models capable of coding
  const generalCodingPatterns = [
    /^qwen2\.5/i,
    /^qwen3/i,
    /^deepseek-r1/i,
    /^deepseek-v/i,
    /^llama3/i,
    /^mistral/i,
    /^gemma2/i,
    /^phi4/i,
    /^command-r/i,
    /^granite3/i,
    /^gpt-oss/i,
  ]

  for (const pattern of generalCodingPatterns) {
    if (pattern.test(baseName) || pattern.test(normalized)) {
      return true
    }
  }

  return false
}

/**
 * Determines if a model is suitable for Document & Text Translation.
 * Matches translation-specific models (aya-expanse, tower-instruct, nllb, etc.)
 * as well as versatile multilingual models (qwen2.5, llama3.1, gemma2, mistral, etc.).
 * Strictly excludes embedding models and vision models.
 */
export function isTranslationModel(name: string): boolean {
  if (!name) return false
  if (isEmbeddingModel(name)) return false
  if (isVisionModel(name)) return false

  const { normalized, baseName } = normalizeModelNameForIntent(name)
  if (!normalized) return false

  if (TRANSLATION_CATALOG_NAMES.has(baseName)) return true

  const translationPatterns = [
    /aya/i,
    /tower-instruct/i,
    /nllb/i,
    /seamless/i,
    /translate/i,
    /translation/i,
    /almaz/i,
  ]

  for (const pattern of translationPatterns) {
    if (pattern.test(normalized) || pattern.test(baseName)) {
      return true
    }
  }

  // Strong multilingual general models
  const multilingualGeneralPatterns = [
    /^qwen2\.5/i,
    /^qwen3/i,
    /^llama3/i,
    /^gemma2/i,
    /^gemma3/i,
    /^mistral/i,
    /^command-r/i,
    /^phi3\.5/i,
    /^phi4/i,
  ]

  for (const pattern of multilingualGeneralPatterns) {
    if (pattern.test(baseName) || pattern.test(normalized)) {
      return true
    }
  }

  return false
}

/**
 * Determines if a model is suitable for Conversational & RAG Chat.
 * Strictly excludes embedding models and pure vision models.
 */
export function isChatModel(name: string): boolean {
  if (!name) return false
  if (isEmbeddingModel(name)) return false
  if (isVisionModel(name)) return false

  const { normalized, baseName } = normalizeModelNameForIntent(name)
  if (!normalized) return false

  if (CHAT_CATALOG_NAMES.has(baseName)) return true

  const chatPatterns = [
    /^llama3/i,
    /^llama2/i,
    /^qwen2\.5/i,
    /^qwen3/i,
    /^mistral/i,
    /^gemma2/i,
    /^gemma3/i,
    /^phi3/i,
    /^phi4/i,
    /^command-r/i,
    /^deepseek-r1/i,
    /^nemotron/i,
    /^hermes/i,
    /^wizardlm/i,
    /^vicuna/i,
    /^zephyr/i,
    /^openchat/i,
    /^solar/i,
    /^granite3/i,
    /^chat/i,
    /instruct/i,
  ]

  for (const pattern of chatPatterns) {
    if (pattern.test(baseName) || pattern.test(normalized)) {
      return true
    }
  }

  return false
}

/**
 * Determines if a model is suitable for Medical & Clinical healthcare domains.
 * Strictly excludes embedding models and vision models.
 */
export function isMedicalModel(name: string): boolean {
  if (!name) return false
  if (isEmbeddingModel(name)) return false
  if (isVisionModel(name)) return false

  const { normalized, baseName } = normalizeModelNameForIntent(name)
  if (!normalized) return false

  if (MEDICAL_CATALOG_NAMES.has(baseName)) return true

  const medicalPatterns = [
    /biomistral/i,
    /meditron/i,
    /medllama/i,
    /clinical/i,
    /pubmed/i,
    /\bmed-/i,
    /\bmedical\b/i,
    /\bbio-/i,
  ]

  for (const pattern of medicalPatterns) {
    if (pattern.test(normalized) || pattern.test(baseName)) {
      return true
    }
  }

  // Broad models with strong medical competency in catalog
  const medicalGeneralBases = ['llama3.1', 'llama3.2', 'llama3.3', 'qwen2.5', 'qwen3', 'command-r']
  for (const bg of medicalGeneralBases) {
    if (baseName.startsWith(bg)) return true
  }

  return false
}

/**
 * Determines if a model is suitable for Legal & Compliance domains.
 * Strictly excludes embedding models and vision models.
 */
export function isLegalModel(name: string): boolean {
  if (!name) return false
  if (isEmbeddingModel(name)) return false
  if (isVisionModel(name)) return false

  const { normalized, baseName } = normalizeModelNameForIntent(name)
  if (!normalized) return false

  if (LEGAL_CATALOG_NAMES.has(baseName)) return true

  const legalPatterns = [
    /legal/i,
    /\blaw\b/i,
    /juris/i,
    /saul/i,
    /lex/i,
    /statute/i,
    /compliance/i,
  ]

  for (const pattern of legalPatterns) {
    if (pattern.test(normalized) || pattern.test(baseName)) {
      return true
    }
  }

  // Broad long-context reasoning models with legal catalog presence
  const legalGeneralBases = ['llama3.1', 'llama3.2', 'llama3.3', 'mistral', 'command-r', 'qwen2.5', 'qwen3']
  for (const lg of legalGeneralBases) {
    if (baseName.startsWith(lg)) return true
  }

  return false
}

/**
 * Checks whether a given model name matches a specified intent.
 */
export function isModelForIntent(modelName: string, intent: ModelIntent): boolean {
  switch (intent) {
    case 'vision':
      return isVisionModel(modelName)
    case 'embedding':
      return isEmbeddingModel(modelName)
    case 'coding':
      return isCodingModel(modelName)
    case 'translation':
      return isTranslationModel(modelName)
    case 'chat':
      return isChatModel(modelName)
    case 'medical':
      return isMedicalModel(modelName)
    case 'legal':
      return isLegalModel(modelName)
    default:
      return false
  }
}

/**
 * Returns all compatible intents for a given model name.
 */
export function getModelIntents(modelName: string): ModelIntent[] {
  if (!modelName) return []
  const intents: ModelIntent[] = []
  const allIntents: ModelIntent[] = ['vision', 'embedding', 'coding', 'translation', 'chat', 'medical', 'legal']
  for (const intent of allIntents) {
    if (isModelForIntent(modelName, intent)) {
      intents.push(intent)
    }
  }
  return intents
}

export interface FilterModelsOptions {
  /** The currently selected or active model; if provided, it is guaranteed to remain in the returned list */
  includeCurrent?: string
  /** Fallback model (if applicable) */
  includeFallback?: string
  /** Curated preset list for this specific slot */
  presetOptions?: string[]
}

/**
 * Filters a list of models by intent, combining matching installed models,
 * curated presets for that intent, and guaranteeing that the currently active model is never hidden.
 */
export function filterModelsByIntent(
  models: string[],
  intent: ModelIntent,
  options?: FilterModelsOptions
): string[] {
  const result = new Set<string>()

  // 1. If currently active model is present, ensure it is included (preserves custom or edge-case models)
  if (options?.includeCurrent && options.includeCurrent.trim()) {
    result.add(options.includeCurrent.trim())
  }

  if (options?.includeFallback && options.includeFallback.trim()) {
    result.add(options.includeFallback.trim())
  }

  // 2. Add preset options (already curated for this intent)
  if (options?.presetOptions) {
    for (const preset of options.presetOptions) {
      if (preset && preset.trim()) {
        result.add(preset.trim())
      }
    }
  }

  // 3. Add installed models that match the intent
  if (models && Array.isArray(models)) {
    for (const model of models) {
      if (!model || typeof model !== 'string') continue
      const trimmed = model.trim()
      if (!trimmed) continue

      if (isModelForIntent(trimmed, intent)) {
        result.add(trimmed)
      }
    }
  }

  return Array.from(result)
}
