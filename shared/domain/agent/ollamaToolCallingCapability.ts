const NATIVE_TOOL_CALLING_FAMILY_PREFIXES = [
  'llama3.1',
  'llama3.2',
  'llama3.3',
  'llama4',
  'qwen2.5',
  'qwen3',
  'mistral-nemo',
  'mistral-small',
  'mistral-large',
  'devstral',
  'command-r',
  'firefunction',
  'granite',
  'gpt-oss',
]

/** Vision variants share a prefix with a tool-calling text family but expose no `tools` capability of their own (`qwen2.5vl` would otherwise match the `qwen2.5` prefix). */
const VISION_ONLY_FAMILY_PREFIXES = ['qwen2.5vl', 'qwen2vl', 'qwen3vl', 'llama3.2-vision']

/** Map of installed model name -> capabilities array, as reported by /api/tags. */
export type ModelCapabilitiesMap = Record<string, string[]>
export type ObservedToolCallingProtocol = 'native' | 'text'

export interface ToolCallingRoute {
  capable: boolean
  /** True only until the first response establishes the protocol for this session/model. */
  probe: boolean
}

/** Resolves explicit Ollama metadata first, then the protocol latched from an earlier turn. */
export function resolveToolCallingRoute(
  modelName: string,
  capabilities: ModelCapabilitiesMap | undefined,
  observed?: ObservedToolCallingProtocol,
): ToolCallingRoute {
  const reported = capabilities?.[modelName]
  if (Array.isArray(reported) && reported.length > 0) {
    return { capable: reported.includes('tools'), probe: false }
  }
  if (observed) return { capable: observed === 'native', probe: false }
  return { capable: true, probe: true }
}

/**
 * Allow-list fallback: does the model's family (name before the `:tag`)
 * start with a known tool-calling-capable prefix?
 */
export function supportsNativeToolCallingByFamily(modelName: string): boolean {
  if (!modelName || typeof modelName !== 'string') return false
  const family = modelName.split(':')[0].toLowerCase().trim()
  if (VISION_ONLY_FAMILY_PREFIXES.some((prefix) => family.startsWith(prefix))) return false
  return NATIVE_TOOL_CALLING_FAMILY_PREFIXES.some((prefix) => family.startsWith(prefix))
}

/** Authoritative check: does Ollama itself report a "tools" capability for this model? */
export function supportsNativeToolCalling(modelName: string, capabilities?: ModelCapabilitiesMap): boolean {
  if (!modelName || typeof modelName !== 'string') return false

  const reported = capabilities?.[modelName]
  if (Array.isArray(reported)) {
    return reported.includes('tools')
  }

  return supportsNativeToolCallingByFamily(modelName)
}
