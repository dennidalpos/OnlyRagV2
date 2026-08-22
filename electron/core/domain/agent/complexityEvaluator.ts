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
  STANDARD_TIER_CATALOG,
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
  agentMode?: 'plan' | 'ask' | 'agent'
}

import { findMatchingInstalledModel, isOllamaModelInstalled } from './modelTagMatcher'
export { findMatchingInstalledModel, isOllamaModelInstalled }

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
 * gpt-tokenizer, multi-file context, failure history, execution mode and hardware profiles), completely
 * eliminating brittle, hardcoded word dictionaries.
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

  // Structural stack trace / diff failure detection (language-independent compiler & git formats)
  const hasStackTraceOrDiff =
    /(?:Traceback \(most recent call last\):|^\s*at\s+[\w\W]+:\d+:\d+|diff --git|---\s+a\/|\+\+\+\s+b\/|SyntaxError:|TypeError:|ReferenceError:|AssertionError)/m.test(
      promptText
    )

  // Structural volume indicators (token budgeting via gpt-tokenizer, multi-file attachments, large context)
  const isLargeContextOrMultiFile =
    attachedFilesCount >= 2 || totalChars > 16000 || promptTokens > 150

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
  } else if (isLargeContextOrMultiFile) {
    tier = 'deep_reasoning'
    reasoning = 'Rilevato contesto multi-file o alto volume di token'
  } else if (
    context.agentMode === 'ask' &&
    promptTokens <= 20 &&
    attachedFilesCount === 0 &&
    totalChars < 1000 &&
    !hasStackTraceOrDiff
  ) {
    // Standalone quick lookup query in ask mode
    tier = 'fast'
    reasoning = 'Rilevata consultazione rapida a basso volume di token'
  }

  const candidateFallbacks = [...buildFallbackChain(STANDARD_TIER_CATALOG, chainTarget), defaultStandard]
  const preferredModel = activeSettings?.codingModel || activeSettings?.complexityStandardModel || defaultStandard || candidateFallbacks[0]

  const { model: selectedModel, isFallback } = resolveModelWithFallback(preferredModel, candidateFallbacks, availableModels)

  const tierName = tier === 'deep_reasoning'
    ? 'Deep Reasoning'
    : tier === 'fast'
      ? 'Fast Tier'
      : 'Standard Tier'

  return {
    tier,
    tierName,
    modelName: selectedModel,
    reasoning,
    isEscalated,
    isFallback,
  }
}
