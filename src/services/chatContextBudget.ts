import { APPROX_CHARS_PER_TOKEN } from '../../shared/domain/agent/charsPerToken'
import {
  classifyHardwareProfileTier,
  isMinimalHardwareHost,
  resolveEffectiveTier,
  type DeclaredHardwareProfile,
  type HardwareFacts,
  type HardwareProfileTier,
} from '../../shared/domain/hardware/hardwareProfileTiers'

/** Hardware-aware context budgeting for the RAG chat turn. */
export interface ChatContextBudget {
  /** Detected (or declared) host tier this budget was derived from. */
  profileTier: HardwareProfileTier
  /** True when the host is minimum hardware (see isMinimalHardwareHost). */
  isMinimal: boolean
  /** Max chars of vector-search results folded into the system prompt. */
  vectorContextChars: number
  /** Max combined chars of retrieval results + selected full-document previews. */
  totalContextChars: number
  /** Max chars taken from each explicitly selected document. */
  perDocumentPreviewChars: number
  /** How many previous conversation turns are replayed to the model. */
  historyTurns: number
  /** Hard cap on the replayed conversation history block. */
  historyChars: number
  /** How many chunks to request from the vector search. */
  vectorTopK: number
  /** User-selected `num_ctx` sent to the generation call. */
  maxNumCtx: number
  /** How long Ollama should keep the chat model resident after the turn. */
  keepAlive: string
}

/** Tokens held back for the answer, and the chars-per-token ratio used to translate the token window into the char budgets everything else is expressed in. */
const GENERATION_RESERVE_TOKENS = 1024

/** Total chars the assembled prompt may occupy on a host, once the answer's own token reserve is held back. */
export function resolvePromptCharBudget(maxNumCtx: number): number {
  const usableTokens = Math.max(512, maxNumCtx - GENERATION_RESERVE_TOKENS)
  return Math.floor(usableTokens * APPROX_CHARS_PER_TOKEN)
}

interface TierBudget {
  vectorContextChars: number
  totalContextChars: number
  perDocumentPreviewChars: number
  historyTurns: number
  historyChars: number
  vectorTopK: number
  maxNumCtx: number
  keepAlive: string
}

/**
 * `midrange` deliberately reproduces the previous one-size-fits-all values, so the tuning
 * on mainstream 8GB-GPU hosts is unchanged and only the extremes move.
 */
const TIER_BUDGETS: Record<HardwareProfileTier, TierBudget> = {
  legacy: {
    vectorContextChars: 2500,
    totalContextChars: 3500,
    perDocumentPreviewChars: 900,
    historyTurns: 8,
    historyChars: 4000,
    vectorTopK: 4,
    maxNumCtx: 4096,
    keepAlive: '5m',
  },
  entry: {
    vectorContextChars: 3000,
    totalContextChars: 4200,
    perDocumentPreviewChars: 1200,
    historyTurns: 12,
    historyChars: 6500,
    vectorTopK: 5,
    maxNumCtx: 8192,
    keepAlive: '30m',
  },
  midrange: {
    vectorContextChars: 4000,
    totalContextChars: 5500,
    perDocumentPreviewChars: 1500,
    historyTurns: 16,
    historyChars: 9000,
    vectorTopK: 5,
    maxNumCtx: 8192,
    keepAlive: '30m',
  },
  highend: {
    vectorContextChars: 6000,
    totalContextChars: 9000,
    perDocumentPreviewChars: 2500,
    historyTurns: 24,
    historyChars: 16000,
    vectorTopK: 6,
    maxNumCtx: 16384,
    keepAlive: '2h',
  },
  extreme: {
    vectorContextChars: 9000,
    totalContextChars: 14000,
    perDocumentPreviewChars: 4000,
    historyTurns: 32,
    historyChars: 28000,
    vectorTopK: 8,
    maxNumCtx: 32768,
    keepAlive: '2h',
  },
}

/** Minimum hardware gets its own floor rather than sharing `legacy`: a 32-core CPU-only workstation and a 4-core 8GB laptop are both `legacy`, but only the latter needs the history and retrieval context cut this far back to stay responsive. */
const MINIMAL_HOST_BUDGET: TierBudget = {
  vectorContextChars: 1800,
  totalContextChars: 2500,
  perDocumentPreviewChars: 700,
  historyTurns: 6,
  historyChars: 2800,
  vectorTopK: 3,
  maxNumCtx: 4096,
  keepAlive: '5m',
}

/** Pins Ollama's CPU thread count, leaving one core for the UI and the sidecar. */
export function resolveChatThreadCount(cpuCount?: number): number | undefined {
  if (!cpuCount || cpuCount <= 0) return undefined
  return Math.max(1, cpuCount - 1)
}

/** Resolves the chat context budget for a host. */
export function resolveChatContextBudget(
  facts: HardwareFacts = {},
  declaredProfile: DeclaredHardwareProfile = 'Auto',
  maxNumCtxOverride?: number,
): ChatContextBudget {
  const profileTier = declaredProfile !== 'Auto' ? resolveEffectiveTier(declaredProfile, facts) : classifyHardwareProfileTier(facts)

  // A manually pinned profile is a deliberate user override, so the minimal-host floor only
  // applies when the tier was detected automatically.
  const isMinimal = declaredProfile === 'Auto' && isMinimalHardwareHost(facts)
  const budget = isMinimal ? MINIMAL_HOST_BUDGET : TIER_BUDGETS[profileTier]

  return { profileTier, isMinimal, ...budget, maxNumCtx: maxNumCtxOverride ? Math.max(2048, Math.floor(maxNumCtxOverride)) : budget.maxNumCtx }
}
