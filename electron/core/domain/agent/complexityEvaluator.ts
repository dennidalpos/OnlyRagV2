import type { AppSettings } from '../../../../src/types'

export type ComplexityTier = 'fast' | 'standard' | 'deep_reasoning'

/**
 * The full model-routing tier vocabulary, including the optional "heavy"
 * escalation tier (14B+ models, only reached via circuit-breaker escalation —
 * see resilientModelDispatcher.ts). Single source of truth for the tier
 * concept shared across complexityEvaluator.ts (task routing),
 * hardwareRecommendationEngine.ts (wizard model recommendations grouped by
 * tier), and resilientModelDispatcher.ts (fallback/escalation cascade),
 * instead of each independently hardcoding the same four tier names.
 */
export type ModelTier = ComplexityTier | 'heavy'

export interface ComplexityRouteResult {
  tier: ComplexityTier
  tierName: string
  modelName: string
  reasoning: string
  isEscalated?: boolean
  isFallback?: boolean
}

export interface ComplexityEvaluationContext {
  attachedFilesCount?: number
  contextSizeChars?: number
  settings?: AppSettings
  availableModels?: string[]
  hasRecentToolFailure?: boolean
  errorCountInHistory?: number
  consecutiveSuccessCount?: number
  vramTotalMB?: number
  hardwareProfile?: 'Low' | 'Medium' | 'High' | 'Auto'
  safeVramBudgetGB?: number
}

// Deep reasoning indicator keywords (EN + IT)
const DEEP_KEYWORDS = [
  'refactor',
  'refactoring',
  'debug',
  'debugging',
  'architecture',
  'architettura',
  'optimise',
  'optimize',
  'ottimizza',
  'ottimizzazione',
  'memory leak',
  'perdita di memoria',
  'stack trace',
  'rewrite',
  'riscrivi',
  'overhaul',
  'security audit',
  'audit',
  'audit di sicurezza',
  'diagnosi',
  'profiling',
  'profiler',
  'bottleneck',
  'collo di bottiglia',
  'deadlock',
  'race condition',
  'concorrenza',
  'concurrency',
  'flussi',
  'pipeline',
  'auto-healing',
  'correzione complessa',
  'test suite',
  'test unitari',
  'unit test',
  'integration test',
  'pytest',
  'vitest',
  'jest',
  'benchmark',
  'migration',
  'migrazione',
  'performance tuning',
  'type check',
  'type error',
  'typescript error',
  'dead code',
  'dashboard',
  'complexity router',
  'tiers',
  'routing',
  'ipc',
  'electron',
  'lancedb',
  'vector database',
  'embedding',
  'sidecar',
  'fastapi',
]

// Fast tier indicator keywords (EN + IT) - Informational / Lookup queries
const FAST_KEYWORDS = [
  'what is',
  'cos è',
  'cosa è',
  'che cos è',
  'che cos\'è',
  'che cosa è',
  'explain',
  'spiega',
  'spiegami',
  'how to',
  'how does',
  'come si fa',
  'come fare',
  'come si usa',
  'define',
  'definisci',
  'where is',
  'dove si trova',
  'dove è',
  'dov\'è',
  'show status',
  'check status',
  'mostra stato',
  'ciao',
  'hello',
  'help',
  'aiuto',
  'syntax for',
  'sintassi per',
  'differenza tra',
  'difference between',
  'a cosa serve',
  'che serve',
  'version',
  'versione',
]

// Coding action imperatives that indicate active generation / modification
const CODING_ACTION_KEYWORDS = [
  'create',
  'crea',
  'implement',
  'implementa',
  'build',
  'write',
  'scrivi',
  'add',
  'aggiungi',
  'modify',
  'modifica',
  'generate',
  'genera',
  'setup',
  'inizializza',
  'configure',
  'configura',
]

// Technical code failure & stack trace signals (Multi-language)
const CODE_FAILURE_PATTERNS = [
  'traceback (most recent call last)',
  'error: at ',
  'syntaxerror:',
  'typeerror:',
  'referenceerror:',
  'fatal error',
  'panic:',
  'exception in thread',
  'assertionerror',
  'diff --git',
  '--- a/',
  '+++ b/',
  'test failed',
  'tests failed',
  'build failed',
  'cannot find module',
  'failed | ',
  'fail | ',
  'err!',
  'sql syntax error',
  'psscriptanalyzer',
  'non-zero exit code',
  'cargo build failed',
  'go build:',
]

function matchesKeyword(text: string, keyword: string): boolean {
  if (keyword.includes(' ') || keyword.includes("'")) {
    return text.includes(keyword)
  }
  const regex = new RegExp(`(?:^|\\b|\\s)${keyword}(?:\\b|\\s|$)`, 'i')
  return regex.test(text)
}

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

  // 3. Namespace strip match (e.g. "adrienbrault/biomistral-7b" vs a bare "biomistral-7b" tag)
  for (const m of available) {
    const mClean = m.toLowerCase().trim()
    const mWithoutNamespace = mClean.includes('/') ? mClean.split('/')[1] : mClean
    if (mWithoutNamespace === cleanWithoutNamespace) return m
  }

  // 4. Base model match with compatible quant/instruction tag
  for (const m of available) {
    const mClean = m.toLowerCase().trim()
    const mBase = mClean.split(':')[0]
    const mTag = mClean.includes(':') ? mClean.split(':')[1] : ''
    if (mBase === cleanBase) {
      if (!cleanTag || cleanTag === 'latest') return m
      if (mTag && (mTag.startsWith(cleanTag) || cleanTag.startsWith(mTag) || mTag.includes(cleanTag) || cleanTag.includes(mTag))) return m
    }
  }

  // 5. Substring base model match (e.g. qwen2.5-coder matching qwen2.5-coder:7b-instruct-q4_k_m)
  for (const m of available) {
    const mClean = m.toLowerCase().trim()
    if (mClean.includes(cleanBase) || cleanBase.includes(mClean.split(':')[0])) {
      return m
    }
  }

  return null
}

function resolveModelWithFallback(
  preferredModel: string,
  candidateFallbacks: string[],
  availableModels?: string[]
): { model: string; isFallback: boolean } {
  if (!availableModels || availableModels.length === 0) {
    return { model: preferredModel, isFallback: false }
  }

  const exactMatch = findMatchingInstalledModel(preferredModel, availableModels)
  if (exactMatch) {
    return { model: exactMatch, isFallback: false }
  }

  for (const fallback of candidateFallbacks) {
    const fallbackMatch = findMatchingInstalledModel(fallback, availableModels)
    if (fallbackMatch) {
      return { model: fallbackMatch, isFallback: true }
    }
  }

  // Final fallback to the first available model if any exists
  const firstAvailable = availableModels[0] || preferredModel
  return { model: firstAvailable, isFallback: firstAvailable !== preferredModel }
}

export function evaluateTaskComplexity(
  userPrompt: string,
  context: ComplexityEvaluationContext = {}
): ComplexityRouteResult {
  const attachedFilesCount = context.attachedFilesCount || 0
  const totalChars = context.contextSizeChars || 0
  const activeSettings = context.settings
  const availableModels = context.availableModels
  const hasRecentToolFailure = !!context.hasRecentToolFailure
  const errorCountInHistory = context.errorCountInHistory || 0
  const consecutiveSuccessCount = context.consecutiveSuccessCount || 0
  let safeVramBudgetGB = context.safeVramBudgetGB
  const vramTotalMB = context.vramTotalMB
  const hardwareProfile: 'Low' | 'Medium' | 'High' | 'Auto' = context.hardwareProfile || activeSettings?.hardwareProfile || 'Auto'

  // If safeVramBudgetGB not explicitly passed, derive from vramTotalMB or hardwareProfile
  if (safeVramBudgetGB === undefined) {
    if (vramTotalMB !== undefined && vramTotalMB > 0) {
      const vramGB = vramTotalMB / 1024
      safeVramBudgetGB = Math.max(0, vramGB * 0.75 - 1.5)
    } else if (hardwareProfile === 'Low') {
      safeVramBudgetGB = 1.5
    } else if (hardwareProfile === 'Medium') {
      safeVramBudgetGB = 4.5
    } else if (hardwareProfile === 'High') {
      safeVramBudgetGB = 9.0
    } else {
      safeVramBudgetGB = 4.5
    }
  }

  const defaultStandard = activeSettings?.complexityStandardModel || activeSettings?.codingModel || activeSettings?.defaultModel || 'qwen2.5-coder:7b'

  if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
    const standardFallbacks =
      safeVramBudgetGB !== undefined && safeVramBudgetGB < 4.0
        ? ['qwen2.5-coder:3b', 'llama3.2:3b', 'qwen2.5-coder:1.5b']
        : ['qwen2.5-coder:7b', 'llama3.1:8b', 'mistral:7b', 'llama3.2:3b']

    const { model, isFallback } = resolveModelWithFallback(
      defaultStandard,
      standardFallbacks,
      availableModels
    )
    return {
      tier: 'standard',
      tierName: 'Standard Tier',
      modelName: model,
      reasoning: 'Prompt predefinito o non specificato',
      isFallback,
    }
  }

  const text = userPrompt.toLowerCase().trim()
  const wordCount = text.split(/\s+/).length

  // High complexity keyword match
  const hasDeepKeyword = DEEP_KEYWORDS.some((kw) => matchesKeyword(text, kw))

  // Code failure / Stack trace signal
  const hasFailurePattern = CODE_FAILURE_PATTERNS.some((pat) => text.includes(pat))

  // Coding action match
  const hasCodingAction = CODING_ACTION_KEYWORDS.some((kw) => matchesKeyword(text, kw))

  // Fast tier indicator match
  const hasFastKeyword = FAST_KEYWORDS.some((kw) => matchesKeyword(text, kw))
  const isFastQuery = wordCount < 25 && attachedFilesCount === 0 && totalChars < 4000 && hasFastKeyword && !hasDeepKeyword && !hasFailurePattern && !hasCodingAction

  let tier: ComplexityTier = 'standard'
  let reasoning = 'Query di codice e modifica file standard'
  let isEscalated = false

  // Circuit breaker: auto-escalate on error, but de-escalate if 2 consecutive steps succeeded
  const shouldDeEscalate = !hasRecentToolFailure && consecutiveSuccessCount >= 2

  if (hasRecentToolFailure || (errorCountInHistory >= 1 && !shouldDeEscalate)) {
    tier = 'deep_reasoning'
    reasoning = 'Auto-healing: Escalation a Deep Reasoning a seguito di errori nei tool/comandi'
    isEscalated = true
  } else if (hasFailurePattern) {
    tier = 'deep_reasoning'
    reasoning = 'Rilevata stack trace, eccezione runtime o diff patch'
  } else if (hasDeepKeyword || attachedFilesCount >= 3 || totalChars > 16000 || wordCount > 80) {
    tier = 'deep_reasoning'
    reasoning = hasDeepKeyword
      ? 'Rilevata istruzione di architettura, refactoring profondo o ottimizzazione'
      : 'Rilevato contesto multi-file ad alto volume di token'
  } else if (isFastQuery) {
    tier = 'fast'
    reasoning = 'Rilevata domanda concettuale rapida o lookup a bassa complessità'
  }

  let preferredModel = ''
  let candidateFallbacks: string[] = []

  if (tier === 'fast') {
    preferredModel = activeSettings?.complexityFastModel || 'qwen2.5-coder:1.5b'
    candidateFallbacks = [
      'qwen2.5-coder:1.5b',
      'qwen2.5-coder:1.5b-instruct-q8_0',
      'qwen2.5-coder:3b',
      'qwen2.5-coder:0.5b',
      'llama3.2:1b',
      'qwen2.5:1.5b',
      'llama3.2:3b',
    ]
  } else if (tier === 'deep_reasoning') {
    // Hardware-bound Deep Reasoning candidate selection strictly tuned for code architecture and refactoring
    const isLegacyOrEntry = safeVramBudgetGB !== undefined && safeVramBudgetGB < 3.0
    const isMidRange = safeVramBudgetGB !== undefined && safeVramBudgetGB >= 3.0 && safeVramBudgetGB < 7.0
    const isExtremeVram = safeVramBudgetGB !== undefined && safeVramBudgetGB >= 12.0

    if (isLegacyOrEntry) {
      // On CPU or low VRAM (< 6GB GPU)
      preferredModel = activeSettings?.complexityDeepModel || 'deepseek-coder:6.7b'
      candidateFallbacks = [
        'deepseek-coder:6.7b',
        'deepseek-coder:6.7b-instruct-q4_k_m',
        'qwen2.5-coder:3b',
        'deepseek-r1:1.5b',
        defaultStandard,
      ]
    } else if (isMidRange) {
      // On 8GB GPUs (Safe Net Budget ~4.5 GB): Qwen2.5-Coder 7B or DeepSeek R1 Distill Qwen 7B
      preferredModel = activeSettings?.complexityDeepModel || 'qwen2.5-coder:7b'
      candidateFallbacks = [
        'qwen2.5-coder:7b',
        'qwen2.5-coder:7b-instruct-q4_k_m',
        'deepseek-r1:7b',
        'deepseek-r1:7b-qwen-distill-q4_k_m',
        'deepseek-coder:6.7b',
        'qwen2.5-coder:3b',
        defaultStandard,
      ]
    } else if (isExtremeVram) {
      // On 24GB+ GPUs: 32B models
      preferredModel = activeSettings?.complexityDeepModel || 'qwen2.5-coder:32b'
      candidateFallbacks = [
        'qwen2.5-coder:32b',
        'deepseek-r1:32b',
        'qwen2.5-coder:14b',
        'deepseek-r1:14b',
        'codestral:22b-v0.1-q4_k_m',
        defaultStandard,
      ]
    } else {
      // High-End 12-16GB VRAM: 14B models
      preferredModel = activeSettings?.complexityDeepModel || 'qwen2.5-coder:14b'
      candidateFallbacks = [
        'qwen2.5-coder:14b',
        'qwen2.5-coder:14b-instruct-q4_k_m',
        'deepseek-r1:14b',
        'deepseek-coder-v2:16b-lite-instruct-q4_k_m',
        'deepseek-r1:8b',
        'qwen2.5-coder:7b',
        defaultStandard,
      ]
    }
  } else {
    // Standard tier
    preferredModel = defaultStandard
    if (safeVramBudgetGB !== undefined && safeVramBudgetGB < 3.0) {
      candidateFallbacks = [
        'qwen2.5-coder:3b',
        'deepseek-coder:6.7b',
        'qwen2.5-coder:1.5b',
        'llama3.2:3b',
        defaultStandard,
      ]
    } else if (safeVramBudgetGB !== undefined && safeVramBudgetGB >= 12.0) {
      candidateFallbacks = [
        'qwen2.5-coder:14b',
        'qwen2.5-coder:7b',
        'codestral:22b-v0.1-q4_k_m',
        defaultStandard,
      ]
    } else {
      candidateFallbacks = [
        'qwen2.5-coder:7b',
        'qwen2.5-coder:7b-instruct-q4_k_m',
        'deepseek-coder:6.7b',
        'qwen2.5-coder:3b',
        'deepseek-coder-v2:16b-lite-instruct-q4_k_m',
        defaultStandard,
      ]
    }
  }

  const { model: selectedModel, isFallback } = resolveModelWithFallback(preferredModel, candidateFallbacks, availableModels)

  return {
    tier,
    tierName: tier === 'fast' ? 'Fast Tier' : tier === 'deep_reasoning' ? (isEscalated ? 'Escalated Deep Reasoning Tier' : 'Deep Reasoning Tier') : 'Standard Tier',
    modelName: selectedModel,
    reasoning,
    isEscalated,
    isFallback,
  }
}
