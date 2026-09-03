import type { RunningModelDetails } from '../../types'
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
  parseCatalogSizeGB,
  type RawModelCatalogEntry,
} from './hardwareModelCatalog'

/**
 * Derives approximate weights from catalog entries.
 */
export const CATALOG_DERIVED_WEIGHTS_GB: Record<string, number> = Object.fromEntries(
  ([
    ...COMPACT_CODING_CATALOG,
    ...WORKHORSE_CODING_CATALOG,
    ...REASONING_CODING_CATALOG,
    ...LARGE_CODING_CATALOG,
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

export const KNOWN_WEIGHT_ALIASES_GB: Record<string, number> = {
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

export const QUANT_BYTES_PER_PARAM: Record<string, number> = {
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
export function estimateWeightFromMetadata(details: RunningModelDetails): number | null {
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

/**
 * Returns estimated model weight in GB based on exact tag catalog or parameter heuristics.
 */
export function estimateModelWeightGB(modelName: string, details?: RunningModelDetails): number {
  const lower = (modelName || '').toLowerCase().trim()
  if (!lower || lower === 'local' || lower === 'none') return 4.5

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

  // Most-specific-key-wins resolution.
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
