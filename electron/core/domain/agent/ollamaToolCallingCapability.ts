/**
 * electron/core/domain/agent/ollamaToolCallingCapability.ts
 *
 * Domain Layer — Native Tool-Calling Capability Detection
 *
 * Determines whether a given Ollama model supports native tool-calling
 * (POST /api/chat with a `tools` array, returning `message.tool_calls`)
 * versus needing the prompt-engineered fallback (toolParser.ts parsing
 * free-text JSON out of a plain completion).
 *
 * Primary signal: Ollama's own `/api/tags` response already reports a
 * `capabilities` array per model (e.g. ["completion", "tools"]) on modern
 * Ollama versions. When that data is available it is authoritative.
 *
 * Fallback signal: a known-family allow-list, for older Ollama versions
 * that don't report `capabilities`, or when the capability map hasn't been
 * fetched yet. Verified empirically against a live Ollama instance:
 * llama3.1/llama3.2, qwen2.5/qwen3, mistral-nemo and command-r families are
 * tagged "tools" capable by Ollama.
 */

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
  'command-r',
  'firefunction',
]

/** Map of installed model name -> capabilities array, as reported by /api/tags. */
export type ModelCapabilitiesMap = Record<string, string[]>

/**
 * Allow-list fallback: does the model's family (name before the `:tag`)
 * start with a known tool-calling-capable prefix?
 */
export function supportsNativeToolCallingByFamily(modelName: string): boolean {
  if (!modelName || typeof modelName !== 'string') return false
  const family = modelName.split(':')[0].toLowerCase().trim()
  return NATIVE_TOOL_CALLING_FAMILY_PREFIXES.some((prefix) => family.startsWith(prefix))
}

/**
 * Authoritative check: does Ollama itself report a "tools" capability for
 * this model? Falls back to the family allow-list when no capability data
 * is available for the model (e.g. capabilities map not fetched, or an
 * older Ollama version that omits the field).
 */
export function supportsNativeToolCalling(modelName: string, capabilities?: ModelCapabilitiesMap): boolean {
  if (!modelName || typeof modelName !== 'string') return false

  const reported = capabilities?.[modelName]
  if (Array.isArray(reported)) {
    return reported.includes('tools')
  }

  return supportsNativeToolCallingByFamily(modelName)
}
