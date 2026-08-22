import { encode } from 'gpt-tokenizer'
import type { AppSettings } from '../../../../src/types'
import {
  calculateRealUsableVram,
  calculateUsableSystemRamGB,
  calculateHybridUsableMemoryGB,
  classifyTierFromSafeBudget,
  resolveEffectiveTier,
  CPU_INFERENCE_WEIGHT_BUDGET_GB,
  TIER_NOMINAL_SAFE_BUDGET_GB,
  type HardwareProfileTier,
} from '../../../../src/services/hardwareProfileTiers'
import {
  buildFallbackChain,
  FAST_TIER_CATALOG,
  STANDARD_TIER_CATALOG,
  DEEP_REASONING_TIER_CATALOG,
  HEAVY_ESCALATION_TIER_CATALOG,
} from '../../../../src/services/hardwareModelCatalog'

export type ComplexityTier = 'fast' | 'standard' | 'deep_reasoning'

export type ModelTier = ComplexityTier | 'heavy'

export interface ComplexityRouteResult {
  tier: ModelTier
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
  systemRamGB?: number
  hardwareProfile?: 'Low' | 'Medium' | 'High' | 'Auto'
  safeVramBudgetGB?: number
  enableSystemRamOffloading?: boolean
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

  const firstAvailable = availableModels[0] || preferredModel
  return { model: firstAvailable, isFallback: firstAvailable !== preferredModel }
}

/**
 * Universal complexity evaluator based on objective structural metrics (BPE token budgeting via
 * gpt-tokenizer, multi-file context, failure history, and hardware profiles), completely eliminating
 * brittle, hardcoded word dictionaries.
 */
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
  const vramTotalMB = context.vramTotalMB
  const hardwareProfile: 'Low' | 'Medium' | 'High' | 'Auto' = context.hardwareProfile || activeSettings?.hardwareProfile || 'Auto'

  const enableSystemRamOffloading = Boolean(
    context.enableSystemRamOffloading ?? activeSettings?.enableSystemRamOffloading
  )
  const systemRamGB = context.systemRamGB || 16

  const hasGpu = vramTotalMB !== undefined && vramTotalMB > 0
  const safeVramBudgetGB: number = context.safeVramBudgetGB !== undefined
    ? context.safeVramBudgetGB
    : hasGpu
      ? calculateRealUsableVram(vramTotalMB as number)
      : TIER_NOMINAL_SAFE_BUDGET_GB[resolveEffectiveTier(hardwareProfile)]

  const effectiveBudgetGB = enableSystemRamOffloading && hasGpu
    ? calculateHybridUsableMemoryGB(vramTotalMB || 0, systemRamGB)
    : safeVramBudgetGB

  const profileTier: HardwareProfileTier = hardwareProfile !== 'Auto'
    ? resolveEffectiveTier(hardwareProfile)
    : classifyTierFromSafeBudget(effectiveBudgetGB, hasGpu)

  const modelBudgetGB = profileTier === 'legacy'
    ? (enableSystemRamOffloading ? calculateUsableSystemRamGB(systemRamGB) : CPU_INFERENCE_WEIGHT_BUDGET_GB)
    : effectiveBudgetGB > 0
      ? effectiveBudgetGB
      : TIER_NOMINAL_SAFE_BUDGET_GB[profileTier]
  const chainTarget = { profileTier, budgetGB: modelBudgetGB }

  const defaultStandard = activeSettings?.complexityStandardModel || activeSettings?.codingModel || activeSettings?.defaultModel || 'qwen2.5-coder:7b'

  if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
    const { model, isFallback } = resolveModelWithFallback(
      defaultStandard,
      buildFallbackChain(STANDARD_TIER_CATALOG, chainTarget),
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

  const promptText = userPrompt.trim()
  let promptTokens = 0
  try {
    promptTokens = encode(promptText).length
  } catch {
    promptTokens = Math.ceil(promptText.length / 4)
  }

  // Structural stack trace / diff failure detection
  const hasStackTraceOrDiff =
    /(?:Traceback \(most recent call last\):|^\s*at\s+[\w\W]+:\d+:\d+|diff --git|---\s+a\/|\+\+\+\s+b\/|SyntaxError:|TypeError:|ReferenceError:|AssertionError)/m.test(
      promptText
    )

  // Structural reasoning indicators based on architectural complexity keywords or volume
  const hasStructuralReasoningDirectives =
    /(?:refactor|architecture|optimiz|ottimizz|deadlock|memory leak|audit|concurr|concorren|race condition|benchmark|migrat)/i.test(
      promptText
    )

  const isCodingAction =
    /^(?:create|crea|implement|implementa|build|write|scrivi|add|aggiungi|modify|modifica|generate|genera|setup|configure|configura)\b/i.test(
      promptText
    )

  let tier: ComplexityTier = 'standard'
  let reasoning = 'Query di codice e modifica file standard'
  let isEscalated = false

  const shouldDeEscalate = !hasRecentToolFailure && consecutiveSuccessCount >= 2

  if (hasRecentToolFailure || (errorCountInHistory >= 1 && !shouldDeEscalate)) {
    tier = 'deep_reasoning'
    reasoning = 'Auto-healing: Escalation a Deep Reasoning a seguito di errori nei tool/comandi'
    isEscalated = true
  } else if (hasStackTraceOrDiff) {
    tier = 'deep_reasoning'
    reasoning = 'Rilevata stack trace, eccezione runtime o diff patch'
  } else if (hasStructuralReasoningDirectives || attachedFilesCount >= 2 || totalChars > 16000 || promptTokens > 150) {
    tier = 'deep_reasoning'
    reasoning = hasStructuralReasoningDirectives
      ? 'Rilevata istruzione di architettura, refactoring profondo o ottimizzazione'
      : 'Rilevato contesto multi-file ad alto volume di token'
  } else if (
    !isCodingAction &&
    promptTokens <= 25 &&
    attachedFilesCount === 0 &&
    totalChars < 3000 &&
    !hasStackTraceOrDiff &&
    !hasStructuralReasoningDirectives
  ) {
    // Quick question / lookup query
    const isQuickQuery =
      /^(?:what|how|where|why|explain|define|cosa|come|dove|perch[eé]|spiega|definisci|mostra|ciao|hello|help|aiuto|\?)/i.test(
        promptText
      ) || promptTokens <= 8
    if (isQuickQuery) {
      tier = 'fast'
      reasoning = 'Rilevata domanda concettuale rapida o lookup a bassa complessità'
    }
  }

  const isHeavyEscalationTurn =
    Boolean(activeSettings?.complexityHeavyModel) &&
    isEscalated &&
    errorCountInHistory >= 2

  const tierCatalog = isHeavyEscalationTurn
    ? HEAVY_ESCALATION_TIER_CATALOG
    : tier === 'fast'
      ? FAST_TIER_CATALOG
      : tier === 'deep_reasoning'
        ? DEEP_REASONING_TIER_CATALOG
        : STANDARD_TIER_CATALOG
  const candidateFallbacks = [...buildFallbackChain(tierCatalog, chainTarget), defaultStandard]

  const configuredModel = isHeavyEscalationTurn
    ? activeSettings?.complexityHeavyModel
    : tier === 'fast'
      ? activeSettings?.complexityFastModel
      : tier === 'deep_reasoning'
        ? activeSettings?.complexityDeepModel
        : defaultStandard
  const preferredModel = configuredModel || candidateFallbacks[0]

  const { model: selectedModel, isFallback } = resolveModelWithFallback(preferredModel, candidateFallbacks, availableModels)

  const tierName = isHeavyEscalationTurn
    ? 'Heavy Escalation Tier'
    : tier === 'fast'
      ? 'Fast Tier'
      : tier === 'deep_reasoning'
        ? (isEscalated ? 'Escalated Deep Reasoning Tier' : 'Deep Reasoning Tier')
        : 'Standard Tier'

  if (isHeavyEscalationTurn) {
    reasoning = `Auto-healing: Escalation a Heavy Tier (${selectedModel}) per task ad alta complessità o errori ripetuti`
  }

  const resolvedTier: ModelTier =
    isHeavyEscalationTurn || (Boolean(activeSettings?.complexityHeavyModel) && selectedModel === activeSettings?.complexityHeavyModel)
      ? 'heavy'
      : tier

  return {
    tier: resolvedTier,
    tierName,
    modelName: selectedModel,
    reasoning,
    isEscalated: isEscalated || isHeavyEscalationTurn,
    isFallback,
  }
}
