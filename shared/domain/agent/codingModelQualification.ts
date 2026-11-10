export type ModelRuntimeStatus = 'compatible' | 'unsupported' | 'unknown'

const UNSUPPORTED_FAMILY_PREFIXES = ['nomic-embed', 'mxbai-embed', 'bge-', 'embeddinggemma', 'all-minilm', 'qwen3-embedding']

export function declaresToolCalling(capabilities: readonly string[] | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.includes('tools')
}

/** Resolve usability from runtime capability metadata. */
export function resolveModelRuntimeStatus(args: { modelName: string; capabilities?: readonly string[] }): ModelRuntimeStatus {
  const name = (args.modelName || '').toLowerCase()
  if (!name) return 'unknown'
  if (UNSUPPORTED_FAMILY_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'unsupported'
  if (args.capabilities === undefined) return 'unknown'
  return declaresToolCalling(args.capabilities) ? 'compatible' : 'unsupported'
}
