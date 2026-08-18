import {
  classifyHardwareProfileTier,
  isMinimalHardwareHost,
  resolveEffectiveTier,
  type DeclaredHardwareProfile,
  type HardwareFacts,
  type HardwareProfileTier,
} from './hardwareProfileTiers'

/**
 * Hardware-aware context budgeting for the RAG chat turn.
 *
 * useChatEngine.ts previously hardcoded a single budget for every machine
 * (VECTOR_CONTEXT_CHAR_BUDGET = 4000, CONTEXT_CHAR_BUDGET = 5500, last 6 turns, 1500 chars
 * per selected document) and, more expensively, called `generateOllamaStream` with no
 * options at all — so every chat request fell through to the transport default of
 * `num_ctx: 16384`. On a CPU-only 8GB host that allocates a KV cache several times larger
 * than the turn needs, out of the same RAM the OS is using, and pays for it again in
 * prompt-eval wall clock on every single message.
 *
 * The budgets below shrink the retrieval context, the replayed history and the per-document
 * preview together, so the four never combine into a prompt the host cannot evaluate
 * quickly. `maxNumCtx` is a ceiling, not a fixed size: the caller pairs it with
 * `calculateDynamicContextWindow` so a short turn on a large machine still allocates a
 * small KV cache.
 */
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
  /** Upper bound for the dynamically sized `num_ctx` of the generation call. */
  maxNumCtx: number
  /** How long Ollama should keep the chat model resident after the turn. */
  keepAlive: string
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
    historyTurns: 4,
    historyChars: 1800,
    vectorTopK: 4,
    maxNumCtx: 4096,
    keepAlive: '5m',
  },
  entry: {
    vectorContextChars: 3000,
    totalContextChars: 4200,
    perDocumentPreviewChars: 1200,
    historyTurns: 4,
    historyChars: 2200,
    vectorTopK: 5,
    maxNumCtx: 8192,
    keepAlive: '30m',
  },
  midrange: {
    vectorContextChars: 4000,
    totalContextChars: 5500,
    perDocumentPreviewChars: 1500,
    historyTurns: 6,
    historyChars: 3000,
    vectorTopK: 5,
    maxNumCtx: 8192,
    keepAlive: '30m',
  },
  highend: {
    vectorContextChars: 6000,
    totalContextChars: 9000,
    perDocumentPreviewChars: 2500,
    historyTurns: 8,
    historyChars: 4500,
    vectorTopK: 6,
    maxNumCtx: 16384,
    keepAlive: '2h',
  },
  extreme: {
    vectorContextChars: 9000,
    totalContextChars: 14000,
    perDocumentPreviewChars: 4000,
    historyTurns: 10,
    historyChars: 6000,
    vectorTopK: 8,
    maxNumCtx: 32768,
    keepAlive: '2h',
  },
}

/**
 * Minimum hardware gets its own floor rather than sharing `legacy`: a 32-core CPU-only
 * workstation and a 4-core 8GB laptop are both `legacy`, but only the latter needs the
 * history and retrieval context cut this far back to stay responsive.
 */
const MINIMAL_HOST_BUDGET: TierBudget = {
  vectorContextChars: 1800,
  totalContextChars: 2500,
  perDocumentPreviewChars: 700,
  historyTurns: 2,
  historyChars: 1200,
  vectorTopK: 3,
  maxNumCtx: 4096,
  keepAlive: '5m',
}

/** Pins Ollama's CPU thread count, leaving one core for the UI and the sidecar. */
export function resolveChatThreadCount(cpuCount?: number): number | undefined {
  if (!cpuCount || cpuCount <= 0) return undefined
  return Math.max(1, cpuCount - 1)
}

/**
 * Resolves the chat context budget for a host. An explicit `Low`/`Medium`/`High` profile
 * overrides detection (matching how the agent runtime options treat the same setting);
 * `Auto` classifies from the detected GPU/RAM/CPU facts.
 */
export function resolveChatContextBudget(
  facts: HardwareFacts = {},
  declaredProfile: DeclaredHardwareProfile = 'Auto'
): ChatContextBudget {
  const profileTier = declaredProfile !== 'Auto'
    ? resolveEffectiveTier(declaredProfile, facts)
    : classifyHardwareProfileTier(facts)

  // A manually pinned profile is a deliberate user override, so the minimal-host floor only
  // applies when the tier was detected automatically.
  const isMinimal = declaredProfile === 'Auto' && isMinimalHardwareHost(facts)
  const budget = isMinimal ? MINIMAL_HOST_BUDGET : TIER_BUDGETS[profileTier]

  return { profileTier, isMinimal, ...budget }
}
