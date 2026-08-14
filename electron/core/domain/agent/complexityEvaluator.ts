import type { AppSettings } from '../../../../src/types'

export type ComplexityTier = 'fast' | 'standard' | 'deep_reasoning'

export interface ComplexityRouteResult {
  tier: ComplexityTier
  tierName: string
  modelName: string
  badgeLabel: string
  badgeColorClass: string
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
  'audit di sicurezza',
  'diagnosi',
  'profiling',
  'deadlock',
  'race condition',
  'concorrenza',
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
  'dead code',
]

// Fast tier indicator keywords (EN + IT)
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
  'list',
  'elenca',
  'mostra',
  'show',
  'status',
  'stato',
  'ciao',
  'hello',
  'help',
  'aiuto',
  'versione',
  'version',
  'syntax',
  'sintassi',
  'differenza tra',
  'difference between',
  'a cosa serve',
]

// Technical code failure & stack trace signals
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
]

function matchesKeyword(text: string, keyword: string): boolean {
  if (keyword.includes(' ') || keyword.includes("'")) {
    return text.includes(keyword)
  }
  const regex = new RegExp(`(?:^|\\b|\\s)${keyword}(?:\\b|\\s|$)`, 'i')
  return regex.test(text)
}

function isModelPresent(target: string, available: string[]): boolean {
  if (!available || available.length === 0) return true
  const clean = target.toLowerCase().trim()
  const cleanBase = clean.split(':')[0]
  const cleanTag = clean.includes(':') ? clean.split(':')[1] : ''

  return available.some((m) => {
    const mClean = m.toLowerCase().trim()
    if (
      mClean === clean ||
      mClean === `${clean}:latest` ||
      `${mClean}:latest` === clean
    ) {
      return true
    }
    const mBase = mClean.split(':')[0]
    const mTag = mClean.includes(':') ? mClean.split(':')[1] : ''
    // Allow matching when base model matches and tags share the common prefix (e.g. 7b vs 7b-instruct-q4_K_M)
    if (mBase === cleanBase) {
      if (!cleanTag || cleanTag === 'latest') return true
      if (mTag && (mTag.startsWith(cleanTag) || cleanTag.startsWith(mTag))) return true
    }
    return false
  })
}

function resolveModelWithFallback(
  preferredModel: string,
  candidateFallbacks: string[],
  availableModels?: string[]
): { model: string; isFallback: boolean } {
  if (!availableModels || availableModels.length === 0) {
    return { model: preferredModel, isFallback: false }
  }

  if (isModelPresent(preferredModel, availableModels)) {
    return { model: preferredModel, isFallback: false }
  }

  for (const fallback of candidateFallbacks) {
    if (isModelPresent(fallback, availableModels)) {
      return { model: fallback, isFallback: true }
    }
  }

  // Final fallback to the first available model if any exists
  const firstAvailable = availableModels[0] || preferredModel
  return { model: firstAvailable, isFallback: firstAvailable !== preferredModel }
}

export function evaluateTaskComplexity(
  userPrompt: string,
  attachedFilesOrContext: number | ComplexityEvaluationContext = 0,
  contextSizeChars: number = 0,
  settings?: AppSettings
): ComplexityRouteResult {
  let attachedFilesCount = 0
  let totalChars = contextSizeChars
  let activeSettings = settings
  let availableModels: string[] | undefined = undefined
  let hasRecentToolFailure = false
  let errorCountInHistory = 0

  if (typeof attachedFilesOrContext === 'object' && attachedFilesOrContext !== null) {
    attachedFilesCount = attachedFilesOrContext.attachedFilesCount || 0
    totalChars = attachedFilesOrContext.contextSizeChars || 0
    activeSettings = attachedFilesOrContext.settings || settings
    availableModels = attachedFilesOrContext.availableModels
    hasRecentToolFailure = !!attachedFilesOrContext.hasRecentToolFailure
    errorCountInHistory = attachedFilesOrContext.errorCountInHistory || 0
  } else if (typeof attachedFilesOrContext === 'number') {
    attachedFilesCount = attachedFilesOrContext
  }

  const defaultStandard = activeSettings?.complexityStandardModel || activeSettings?.codingModel || activeSettings?.defaultModel || 'qwen2.5-coder:7b'

  if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
    const { model, isFallback } = resolveModelWithFallback(
      defaultStandard,
      ['llama3.1:8b', 'llama3.2:8b', 'mistral:7b', 'codellama:7b'],
      availableModels
    )
    return {
      tier: 'standard',
      tierName: 'Standard Tier',
      modelName: model,
      badgeLabel: `🔵 Standard (${model})`,
      badgeColorClass: 'bg-cyan-950 text-cyan-300 border-cyan-800/80',
      reasoning: 'Prompt predefinito o non specificato',
      isFallback,
    }
  }

  const text = userPrompt.toLowerCase().trim()
  const wordCount = text.split(/\s+/).length

  // High complexity keyword match
  const hasDeepKeyword = DEEP_KEYWORDS.some((kw) => matchesKeyword(text, kw))

  // Code failure / Stack trace match
  const hasFailurePattern = CODE_FAILURE_PATTERNS.some((pat) => text.includes(pat))

  // Fast tier indicator match
  const hasFastKeyword = FAST_KEYWORDS.some((kw) => matchesKeyword(text, kw))
  const isFastQuery = wordCount < 20 && attachedFilesCount === 0 && totalChars < 4000 && hasFastKeyword && !hasDeepKeyword && !hasFailurePattern

  let tier: ComplexityTier = 'standard'
  let reasoning = 'Query di codice e modifica file standard'
  let isEscalated = false

  if (hasRecentToolFailure || errorCountInHistory >= 1) {
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
    preferredModel = activeSettings?.complexityFastModel || 'qwen2.5:3b'
    candidateFallbacks = ['llama3.2:3b', 'llama3.2:1b', 'qwen2.5:1.5b', defaultStandard]
  } else if (tier === 'deep_reasoning') {
    preferredModel = activeSettings?.complexityDeepModel || 'deepseek-r1:8b'
    candidateFallbacks = ['deepseek-r1:14b', 'qwen2.5-coder:14b', 'deepseek-r1:1.5b', defaultStandard]
  } else {
    preferredModel = defaultStandard
    candidateFallbacks = ['qwen2.5-coder:7b', 'llama3.1:8b', 'llama3.2:8b', 'mistral:7b']
  }

  const { model: selectedModel, isFallback } = resolveModelWithFallback(preferredModel, candidateFallbacks, availableModels)

  const badgeMap: Record<ComplexityTier, { label: string; class: string }> = {
    fast: {
      label: '🟢 Fast',
      class: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80',
    },
    standard: {
      label: '🔵 Standard',
      class: 'bg-cyan-950/80 text-cyan-300 border-cyan-800/80',
    },
    deep_reasoning: {
      label: isEscalated ? '⚡ Escalated Reasoning' : '🟣 Deep Reasoning',
      class: 'bg-purple-950/80 text-purple-300 border-purple-800/80',
    },
  }

  return {
    tier,
    tierName: tier === 'fast' ? 'Fast Tier' : tier === 'deep_reasoning' ? (isEscalated ? 'Escalated Deep Reasoning Tier' : 'Deep Reasoning Tier') : 'Standard Tier',
    modelName: selectedModel,
    badgeLabel: badgeMap[tier].label,
    badgeColorClass: badgeMap[tier].class,
    reasoning,
    isEscalated,
    isFallback,
  }
}
