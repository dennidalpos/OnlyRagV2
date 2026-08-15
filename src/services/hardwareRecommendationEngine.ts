import { DiagnosticsData } from '../types'

export type HardwareProfileTier = 'legacy' | 'entry' | 'midrange' | 'highend' | 'extreme'

export interface ModelRecommendation {
  modelName: string
  displayName: string
  family: string
  sizeBytesApprox: string
  description: string
  isRecommended: boolean
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
 * Returns an approximate memory/disk footprint string based on known model tags and parameter counts.
 */
export function getModelApproxSize(modelName: string): string | undefined {
  if (!modelName) return undefined
  const lower = modelName.toLowerCase().trim()
  if (lower === 'local' || lower === 'none') return undefined

  // Specific known catalog tags
  const knownSizes: Record<string, string> = {
    'nomic-embed-text:latest': '274 MB',
    'nomic-embed-text': '274 MB',
    'all-minilm:latest': '120 MB',
    'all-minilm': '120 MB',
    'bge-m3:latest': '1.1 GB',
    'bge-m3': '1.1 GB',
    'snowflake-arctic-embed:latest': '600 MB',
    'snowflake-arctic-embed': '600 MB',
    'mxbai-embed-large:latest': '670 MB',
    'mxbai-embed-large': '670 MB',
    'moondream:latest': '1.7 GB',
    'moondream': '1.7 GB',
    'llama3.2:1b': '1.3 GB',
    'qwen2.5:1.5b': '1.0 GB',
    'qwen2.5-coder:1.5b': '1.1 GB',
    'deepseek-r1:1.5b': '1.1 GB',
    'gemma2:2b': '1.6 GB',
    'llama3.2:3b': '2.0 GB',
    'qwen2.5-coder:3b': '1.9 GB',
    'qwen2.5:3b': '1.9 GB',
    'deepseek-coder:6.7b': '3.8 GB',
    'mistral:7b': '4.1 GB',
    'qwen2.5-coder:7b': '4.7 GB',
    'qwen2.5:7b': '4.7 GB',
    'deepseek-r1:7b': '4.7 GB',
    'llava:7b': '4.5 GB',
    'meditron:7b': '4.3 GB',
    'adrienbrault/biomistral-7b:q4_k_m': '4.1 GB',
    'adrienbrault/biomistral-7b': '4.1 GB',
    'llama3.1:8b': '4.9 GB',
    'deepseek-r1:8b': '4.9 GB',
    'aya-expanse:8b': '5.1 GB',
    'minicpm-v:8b': '5.5 GB',
    'gemma2:9b': '5.5 GB',
    'llama3.2-vision:11b': '7.9 GB',
    'solar:10.7b': '6.8 GB',
    'qwen2.5-coder:14b': '9.0 GB',
    'qwen2.5:14b': '9.0 GB',
    'deepseek-r1:14b': '9.2 GB',
    'phi4:14b': '9.1 GB',
    'codestral:22b': '13.0 GB',
    'deepseek-r1:32b': '20.0 GB',
    'qwen2.5-coder:32b': '20.0 GB',
    'command-r:35b': '20.0 GB',
    'meditron:70b': '40.0 GB',
    'llama3.3:70b': '40.0 GB',
    'command-r-plus:104b': '60.0 GB',
  }

  for (const [key, size] of Object.entries(knownSizes)) {
    if (lower === key || lower.startsWith(key) || key.startsWith(lower)) {
      return size
    }
  }

  // Regex pattern matching for parameter sizes in billions (e.g. 0.5b, 1.5b, 7b, 8b, 14b, 32b, 70b)
  const bMatch = lower.match(/(?::|-|_|\b)(\d+(?:\.\d+)?)\s*b(?::|-|_|\b|$)/)
  if (bMatch) {
    const num = parseFloat(bMatch[1])
    if (!isNaN(num) && num > 0) {
      if (num <= 0.6) return `~${Math.round(num * 800)} MB`
      if (num <= 1.2) return '~1.1 GB'
      if (num <= 2.2) return '~1.6 GB'
      if (num <= 3.5) return '~2.0 GB'
      if (num <= 4.5) return '~2.8 GB'
      if (num <= 7.2) return '~4.4 GB'
      if (num <= 8.5) return '~4.9 GB'
      if (num <= 9.5) return '~5.5 GB'
      if (num <= 11.5) return '~7.9 GB'
      if (num <= 14.5) return '~9.0 GB'
      if (num <= 22.5) return '~13.0 GB'
      if (num <= 27.5) return '~17.0 GB'
      if (num <= 35.5) return '~20.0 GB'
      if (num <= 72.0) return '~40.0 GB'
      return `~${(num * 0.6).toFixed(0)} GB`
    }
  }

  // Regex pattern matching for parameter sizes in millions (e.g. 135m, 350m, 500m)
  const mMatch = lower.match(/(?::|-|_|\b)(\d+)\s*m(?::|-|_|\b|$)/)
  if (mMatch) {
    const num = parseInt(mMatch[1], 10)
    if (!isNaN(num) && num > 0 && num < 1000) {
      return `~${num} MB`
    }
  }

  // Keyword-based footprint heuristics
  if (lower.includes('104b')) return '~60.0 GB'
  if (lower.includes('70b') || lower.includes('72b')) return '~40.0 GB'
  if (lower.includes('35b') || lower.includes('32b') || lower.includes('34b')) return '~20.0 GB'
  if (lower.includes('22b') || lower.includes('27b') || lower.includes('20b')) return '~14.0 GB'
  if (lower.includes('14b') || lower.includes('13b') || lower.includes('12b')) return '~9.0 GB'
  if (lower.includes('11b') || lower.includes('10b')) return '~7.9 GB'
  if (lower.includes('9b') || lower.includes('8b')) return '~5.0 GB'
  if (lower.includes('7b') || lower.includes('6.7b')) return '~4.4 GB'
  if (lower.includes('3b') || lower.includes('4b')) return '~2.0 GB'
  if (lower.includes('2b') || lower.includes('1.8b')) return '~1.6 GB'
  if (lower.includes('1.5b') || lower.includes('1b')) return '~1.1 GB'
  if (lower.includes('embed') || lower.includes('nomic') || lower.includes('bge') || lower.includes('minilm')) return '~300-600 MB'
  if (lower.includes('vision') || lower.includes('llava') || lower.includes('minicpm')) return '~4.5 - 8 GB'
  if (lower.includes('tiny') || lower.includes('mini') || lower.includes('small') || lower.includes('micro') || lower.includes('nano')) return '~1.5 - 2.0 GB'

  return '~4.5 GB'
}

/**
 * Accurately determines if a target Ollama model tag is installed locally.
 * Handles exact tag comparisons, implicit ':latest', and registry namespace prefixes.
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
  if (modelName === 'adrienbrault/biomistral-7b:Q4_K_M') return 'BioMistral (7B Q4_K_M)'
  if (modelName === 'meditron:7b') return 'Meditron (7B)'
  if (modelName === 'meditron:70b') return 'Meditron (70B)'
  if (modelName === 'bge-m3:latest') return 'BAAI BGE-M3 (1024d)'
  if (modelName === 'nomic-embed-text:latest') return 'Nomic Embed Text (768d)'
  const base = modelName.split(':')[0].replace(/^(adrienbrault\/|library\/)/, '')
  const tag = modelName.split(':')[1] || 'latest'
  return `${base} (${tag})`
}

/**
 * Analyzes detected host hardware and calculates calibrated, non-saturated model assignments.
 * Models are selected with a minimum 2.5 - 4.5 GB VRAM headroom to accommodate:
 * 1. OS & Desktop Window Manager (DWM) VRAM buffer (0.8 - 1.2 GB)
 * 2. Attention Key-Value Cache at 4k-32k context (1.0 - 2.5 GB)
 * 3. CUDA runtime & tensor memory fragmentation (0.5 GB)
 */
export function analyzeHardwareAndRecommend(diagnostics: DiagnosticsData | null): HardwareRecommendations {
  const hasGpu = diagnostics?.gpu.hasNvidiaGpu || false
  const vramTotalMB = diagnostics?.gpu.vramTotalMB || 0
  const vramGB = Math.floor(vramTotalMB / 1024)
  const systemRamGB = Math.round(diagnostics?.memory.totalRAMGB || 8)

  let profileTier: HardwareProfileTier = 'midrange'
  let profileName = `Mid-Range GPU (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
  let safeVramBudgetGB = 5.0

  if (!hasGpu || vramGB < 4) {
    profileTier = 'legacy'
    profileName = `Legacy / CPU-Only Hardware (${vramGB > 0 ? `${vramGB}GB VRAM` : 'No GPU'} / ${systemRamGB}GB RAM)`
    safeVramBudgetGB = 0
  } else if (vramGB >= 4 && vramGB < 8) {
    profileTier = 'entry'
    profileName = `Entry-Level GPU (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
    safeVramBudgetGB = Math.max(1.8, vramGB - 2.5) // Safe budget: max 2.5-3.5 GB models
  } else if (vramGB >= 8 && vramGB < 12) {
    profileTier = 'midrange'
    profileName = `Mid-Range GPU (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
    safeVramBudgetGB = Math.max(3.5, vramGB - 4.5) // Safe budget: 3.5 GB models (leaves ~4.5GB for KV cache + Windows DWM reserve)
  } else if (vramGB >= 12 && vramGB < 20) {
    profileTier = 'highend'
    profileName = `High-End Performance GPU (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
    safeVramBudgetGB = Math.max(9.0, vramGB - 4.5) // Safe budget: max 9.2 GB models (leaves ~5-7GB for 32k KV)
  } else {
    profileTier = 'extreme'
    profileName = `Extreme Workstation (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
    safeVramBudgetGB = Math.max(18.0, vramGB - 6.0)
  }

  const gpuSummary = hasGpu
    ? `${diagnostics?.gpu.gpuName || 'NVIDIA GPU'} (${vramGB} GB VRAM)`
    : 'No Dedicated GPU Detected (CPU Execution)'
  const ramSummary = `${systemRamGB} GB System RAM`

  // 🟢 Fast Tier Recommendations (Lightweight models: 1B - 3B)
  const fastTierModels: ModelRecommendation[] = [
    {
      modelName: 'qwen2.5-coder:1.5b',
      displayName: 'Qwen 2.5 Coder (1.5B)',
      family: 'qwen-coder',
      sizeBytesApprox: '1.1 GB',
      description: 'Ultra-fast code completion with minimal memory footprint & rapid token response',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange',
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
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Balanced lightweight model for quick lookups, doc inspection & rapid editing',
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
      modelName: 'qwen2.5:1.5b',
      displayName: 'Qwen 2.5 (1.5B)',
      family: 'qwen',
      sizeBytesApprox: '1.0 GB',
      description: 'Fast Alibaba lightweight instruction model for concise task routing',
      isRecommended: false,
    },
  ]

  // 🔵 Standard Tier Recommendations (Balanced workhorse models: 3B - 7B)
  const standardTierModels: ModelRecommendation[] = [
    {
      modelName: 'qwen2.5-coder:3b',
      displayName: 'Qwen 2.5 Coder (3B)',
      family: 'qwen-coder',
      sizeBytesApprox: '1.9 GB',
      description: 'Balanced low-VRAM coding assistant preserving full headroom on 4-8GB GPUs',
      isRecommended: profileTier === 'entry' || profileTier === 'midrange',
    },
    {
      modelName: 'qwen2.5-coder:7b',
      displayName: 'Qwen 2.5 Coder (7B)',
      family: 'qwen-coder',
      sizeBytesApprox: '4.7 GB',
      description: 'State-of-the-art coding workhorse with high JSON precision & tool calling support',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Balanced low-memory standard model for CPU/Legacy systems',
      isRecommended: profileTier === 'legacy',
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
      modelName: 'llama3.1:8b',
      displayName: 'Llama 3.1 (8B)',
      family: 'llama',
      sizeBytesApprox: '4.9 GB',
      description: 'Meta 8B balanced instruction & conversation model',
      isRecommended: false,
    },
    {
      modelName: 'codestral:22b',
      displayName: 'Mistral Codestral (22B Q4)',
      family: 'mistral',
      sizeBytesApprox: '13.0 GB',
      description: 'Mistral high-capacity enterprise code intelligence model',
      isRecommended: false,
    },
    {
      modelName: 'mistral:7b',
      displayName: 'Mistral (7B)',
      family: 'mistral',
      sizeBytesApprox: '4.1 GB',
      description: 'High-speed European LLM for text and documentation',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-coder:6.7b',
      displayName: 'DeepSeek Coder (6.7B)',
      family: 'deepseek',
      sizeBytesApprox: '3.8 GB',
      description: 'DeepSeek specialized code generation model',
      isRecommended: false,
    },
  ]

  // 🟣 Deep Reasoning Tier Recommendations (Multi-step reasoning models)
  const deepReasoningTierModels: ModelRecommendation[] = [
    {
      modelName: 'deepseek-r1:1.5b',
      displayName: 'DeepSeek R1 (1.5B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '1.1 GB',
      description: 'Lightweight reasoning model for CPU, 4GB, and 8GB hardware with zero lockups',
      isRecommended: profileTier === 'legacy' || profileTier === 'entry' || profileTier === 'midrange',
    },
    {
      modelName: 'deepseek-r1:8b',
      displayName: 'DeepSeek R1 (8B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '4.9 GB',
      description: 'Advanced step-by-step reasoning model for 12GB+ GPUs (leaves ~7GB for KV cache)',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'deepseek-r1:14b',
      displayName: 'DeepSeek R1 (14B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '9.2 GB',
      description: 'High-capacity reasoning engine for deep technical analysis on high-end hardware',
      isRecommended: profileTier === 'extreme',
    },
    {
      modelName: 'deepseek-r1:32b',
      displayName: 'DeepSeek R1 (32B)',
      family: 'deepseek-r1',
      sizeBytesApprox: '20.0 GB',
      description: 'Ultra-capacity reasoning model for high-end workstations & multi-GPU servers',
      isRecommended: false,
    },
    {
      modelName: 'phi4:14b',
      displayName: 'Microsoft Phi-4 (14B)',
      family: 'phi',
      sizeBytesApprox: '9.1 GB',
      description: 'Microsoft state-of-the-art synthetic reasoning & math assistant',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:14b',
      displayName: 'Qwen 2.5 Coder (14B)',
      family: 'qwen-coder',
      sizeBytesApprox: '9.0 GB',
      description: 'Large-scale coding model for architectural refactoring',
      isRecommended: false,
    },
  ]

  // 💬 General / RAG Chat Models (Outside Coding Complexity Router)
  const chatTierModels: ModelRecommendation[] = [
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

  // 🌐 Document Translation Models (Specialized vertical translation)
  const translationTierModels: ModelRecommendation[] = [
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

  // 👁️ Vision Tier Recommendations (OCR, Multimodal & Layouts)
  const visionTierModels: ModelRecommendation[] = [
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
  const embeddingTierModels: ModelRecommendation[] = [
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

  // 🏥 Medical & Healthcare Domain Models (Verified Ollama Tags)
  const medicalTierModels: ModelRecommendation[] = [
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

  // ⚖️ Legal & Compliance Domain Models
  const legalTierModels: ModelRecommendation[] = [
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
    fastTierModels,
    standardTierModels,
    deepReasoningTierModels,
    chatTierModels,
    translationTierModels,
    medicalTierModels,
    legalTierModels,
    visionTierModels,
    embeddingTierModels,
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
