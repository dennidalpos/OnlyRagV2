/** Evidence-backed model badges; fit and agent qualification are separate concerns. */

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

/** Models qualified by the live probes recorded in `evidence`. */
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

/** Models the agent loop cannot drive, whatever their coding ability. */
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

/** Resolves the badge a model should carry. */
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

  // An installed model that reports no `tools` capability cannot drive the agent's native tool-calling path.
  if (args.capabilities !== undefined && !declaresToolCalling(args.capabilities)) {
    return 'unsupported'
  }

  return args.isCatalogued ? 'compatible' : 'unknown'
}

/** The evidence behind a `verified` badge, for the tooltip. Null for every other status. */
export function findVerificationEvidence(modelName: string): VerificationEvidence | null {
  return VERIFIED_BY_NAME.get(modelName)?.evidence || null
}
