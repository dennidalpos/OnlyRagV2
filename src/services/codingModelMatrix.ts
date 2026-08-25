/**
 * Coding Model Matrix — which models this app has actually been run against.
 *
 * The catalog in `hardwareModelCatalog.ts` answers a different question: *will this model fit
 * in your VRAM*. That is a sizing judgement, computed from a weight in gigabytes, and it says
 * nothing about whether the agent loop works with the model. A 3B model fits beautifully on a
 * 4 GB card and cannot hold a fifteen-milestone plan; a model without native tool calling fits
 * anywhere and fails at step 1.
 *
 * This module answers the second question, and answers it from evidence only.
 *
 * ## The rule this file exists to enforce
 *
 * `verified` means: a full live probe was run end to end against this model, and the run was
 * read. Nothing else earns it — not "it is a coding model", not "it is popular", not "it
 * declares tools". The rest of this codebase spent several waves removing claims that were
 * asserted rather than checked (see milestoneVerificationPromotion.ts and the audit sessions it
 * cites), and a green tick in a settings panel is exactly such a claim, shown to a user who
 * cannot verify it.
 *
 * That is why `VERIFIED_MODELS` below is short. It is short because it is true.
 *
 * ## The four states
 *
 * - `verified`    — run against the live probes, with the evidence recorded inline.
 * - `compatible`  — declares the capability the agent requires (native tool calling) and is
 *                   catalogued, but has not been run. Usable; unproven.
 * - `unsupported` — known to lack something the agent needs. Selectable, at the user's risk.
 * - `unknown`     — any tag the user pulled that this catalog has never heard of.
 */

import type { HardwareProfileTier } from './hardwareProfileTiers'

export type ModelVerificationStatus = 'verified' | 'compatible' | 'unsupported' | 'unknown'

/** What was actually run, so the badge can be defended rather than trusted. */
export interface VerificationEvidence {
  /** ISO date of the run whose log was read. */
  date: string
  /** The live scenarios exercised — see scripts/live/. */
  probes: string[]
  /** What the run showed, including what it failed to do. Never a marketing sentence. */
  outcome: string
}

export interface VerifiedModelRecord {
  modelName: string
  evidence: VerificationEvidence
}

/**
 * Models this app has been run against end to end.
 *
 * One entry, because one model has been run. `qwen2.5-coder:7b` drove every live session behind
 * blueprint §5.4 to §5.6f: five sessions on 2026-08-24 alone, two ERESOLVE probes and three
 * fifty-step full-task runs, plus the 2026-08-25 runs, all read step by step.
 *
 * The outcome is recorded as it happened, failures included. The badge says the delivered
 * project compiles because a run showed it compiling, and says the plan does not finish
 * because no run has finished one. A "verified" badge that reported only the first half would
 * be worse than no badge: the user would read it as a promise the app cannot keep.
 *
 * `qwen2.5-coder:14b` is deliberately NOT here. It was run once (2026-08-25, fullTask, clean
 * system) and did worse — 0/13 verified, five failed builds — and one run is not an entry.
 *
 * To add a model here: run `npx vitest run --config vitest.live.config.mts`, read
 * `logs/coding_agent_audit.log`, and write down what it did. See docs/agent-live-testing.md.
 */
export const VERIFIED_MODELS: VerifiedModelRecord[] = [
  {
    modelName: 'qwen2.5-coder:7b',
    evidence: {
      date: '2026-08-25',
      probes: ['eresolveRecovery.live.ts', 'fullTaskRun.live.ts'],
      outcome:
        'Emits well-formed tool calls, recovers from an npm ERESOLVE conflict without --force, and reaches finish on the focused probe. On the fifty-step full task it scaffolds a project that compiles, and runs the project\'s own check inside the session. It does not finish the plan: the fifty steps run out first, and a typecheck over every file still reports real errors it does not fix.',
    },
  },
]

const VERIFIED_BY_NAME = new Map(VERIFIED_MODELS.map((m) => [m.modelName, m]))

/**
 * Models the agent loop cannot drive, whatever their coding ability.
 *
 * The agent is a tool-calling loop: every turn must produce a parseable tool call. Embedding
 * models have no chat surface at all, and pure fill-in-the-middle base models emit code
 * continuations rather than structured calls. Both are listed by FAMILY prefix, because the
 * failure is a property of the family and not of a particular tag.
 */
const UNSUPPORTED_FAMILY_PREFIXES = [
  'nomic-embed',
  'mxbai-embed',
  'bge-',
  'embeddinggemma',
  'all-minilm',
]

/** Native tool calling, as Ollama reports it in `/api/tags` -> `capabilities`. */
export function declaresToolCalling(capabilities: readonly string[] | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.includes('tools')
}

/**
 * Resolves the badge a model should carry.
 *
 * `capabilities` and `isCatalogued` come from different places on purpose: capabilities are
 * live facts read from the running Ollama and are absent for a model that is not installed
 * yet, while the catalog is static and answers for models the user has never pulled. A badge
 * has to render in both cases — before the download and after it.
 */
export function resolveVerificationStatus(args: {
  modelName: string
  isCatalogued: boolean
  /** From `/api/tags`; undefined when the model is not installed. */
  capabilities?: readonly string[]
}): ModelVerificationStatus {
  const name = (args.modelName || '').toLowerCase()
  if (!name) return 'unknown'

  if (UNSUPPORTED_FAMILY_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'unsupported'
  if (VERIFIED_BY_NAME.has(args.modelName)) return 'verified'

  // An installed model that reports no `tools` capability cannot drive the agent's native
  // tool-calling path. It is not refused — the JSON-fenced fallback exists — but the user is
  // told, because that fallback is measurably weaker on small models.
  if (args.capabilities !== undefined && !declaresToolCalling(args.capabilities)) {
    return 'unsupported'
  }

  return args.isCatalogued ? 'compatible' : 'unknown'
}

/** The evidence behind a `verified` badge, for the tooltip. Null for every other status. */
export function findVerificationEvidence(modelName: string): VerificationEvidence | null {
  return VERIFIED_BY_NAME.get(modelName)?.evidence || null
}

/**
 * The set the wizard installs in one click, for a given hardware tier.
 *
 * Ordered by preference, verified first. `recommendedForProfiles` on the catalog entry decides
 * hardware fit; this function decides trust, and returns hardware-fitting VERIFIED models ahead
 * of hardware-fitting catalogued ones.
 *
 * Returns an empty list rather than a fallback when nothing fits: a wizard that installs a
 * model too large for the machine has done the user harm, and "nothing fits your hardware" is
 * a real answer the UI can act on.
 */
export function selectWizardCodingSet<T extends { modelName: string; recommendedForProfiles: HardwareProfileTier[] }>(
  catalog: readonly T[],
  tier: HardwareProfileTier
): T[] {
  const fits = catalog.filter((entry) => entry.recommendedForProfiles.includes(tier))
  return [...fits].sort((a, b) => {
    const aVerified = VERIFIED_BY_NAME.has(a.modelName) ? 0 : 1
    const bVerified = VERIFIED_BY_NAME.has(b.modelName) ? 0 : 1
    return aVerified - bVerified
  })
}
