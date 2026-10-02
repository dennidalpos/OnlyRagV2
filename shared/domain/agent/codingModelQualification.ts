export type ModelRuntimeStatus = 'compatible' | 'unsupported' | 'unknown'

export interface CodingModelEvidence {
  date: string
  probes: string[]
  outcome: string
}

// Historical probe results apply only to the recorded runs, not every installation of a tag.
const MODEL_EVIDENCE: Record<string, CodingModelEvidence> = {
  'qwen2.5-coder:7b': {
    date: '2026-08-25',
    probes: ['eresolveRecovery.live.ts', 'fullTaskRun.live.ts'],
    outcome:
      "Emits well-formed tool calls, recovers from an npm ERESOLVE conflict without --force, and reaches finish on the focused probe. On the fifty-step full task it scaffolds a project that compiles, and runs the project's own check inside the session. It does not finish the plan: the fifty steps run out first, and a typecheck over every file still reports real errors it does not fix.",
  },
  'qwen3.5:9b': {
    date: '2026-10-01',
    probes: ['codingScenarios.live.ts', 'taskLabSequence.live.ts'],
    outcome:
      'Eight focused scenarios passed in one isolated replay with thinking enabled and num_ctx=16384: Ask reading, storage interview, Guided import recovery, denied mutation with cancellation, denied commit, filesystem rollback, concurrent-edit recovery and ordinary consent refusal recovery. Executor seed plans and frozen fixtures were declared. TaskLab has zero complete sequences and zero qualified stages after three failed planning attempts; global/local plan coverage remains unresolved. These results do not qualify autonomous coding or another runtime configuration. Evidence: docs/reliability-audit-2026-10-01.md.',
  },
}

const UNSUPPORTED_FAMILY_PREFIXES = ['nomic-embed', 'mxbai-embed', 'bge-', 'embeddinggemma', 'all-minilm', 'qwen3-embedding']

export function declaresToolCalling(capabilities: readonly string[] | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.includes('tools')
}

/** Runtime capability metadata never establishes full-task qualification. */
export function resolveModelRuntimeStatus(args: { modelName: string; capabilities?: readonly string[] }): ModelRuntimeStatus {
  const name = (args.modelName || '').toLowerCase()
  if (!name) return 'unknown'
  if (UNSUPPORTED_FAMILY_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'unsupported'
  if (args.capabilities === undefined) return 'unknown'
  return declaresToolCalling(args.capabilities) ? 'compatible' : 'unsupported'
}

export function findCodingModelEvidence(modelName: string): CodingModelEvidence | null {
  const name = modelName.toLowerCase()
  return Object.hasOwn(MODEL_EVIDENCE, name) ? MODEL_EVIDENCE[name] : null
}
