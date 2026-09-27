import type { AgentToolCall, SupportedToolName } from './agentTypes'
import { OLLAMA_TOOL_SCHEMA_CATALOG } from './ollamaToolSchemaCatalog'
import { validateAndSanitize, normalizeToolName } from './toolSchemaValidator'

export type { AgentToolCall }

/** Why one candidate tool call was refused, so the caller can tell the model something useful. */
export interface ToolCallRejection {
  toolName: string
  errors: string[]
}

/** Notified for every call the validator refused. See parseNativeToolCall. */
export type ToolCallRejectionSink = (rejection: ToolCallRejection) => void

/** Validates an Ollama function call without interpreting prose or repairing JSON. */
export function parseNativeToolCall(name: string, args: Record<string, unknown>, onRejection?: ToolCallRejectionSink): AgentToolCall | null {
  const toolName = normalizeToolName(name)
  if (!toolName) {
    onRejection?.({ toolName: name, errors: ['Unknown tool name'] })
    return null
  }
  const validation = validateAndSanitize({ tool: toolName, parameters: args })
  if (!validation.valid) {
    onRejection?.({ toolName: name, errors: validation.errors })
    return null
  }
  return validation.sanitizedToolCall
}

/** Accepts only a complete JSON tool envelope from the observed qwen2.5-coder compatibility path. */
export function parseExactJsonToolCall(content: string, allowedTools: readonly SupportedToolName[]): AgentToolCall | null {
  const text = content.trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return null

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null
    throw error
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const envelope = value as Record<string, unknown>
  if (Object.keys(envelope).length !== 2 || typeof envelope.name !== 'string' || !allowedTools.includes(envelope.name as SupportedToolName)) return null
  if (!envelope.arguments || typeof envelope.arguments !== 'object' || Array.isArray(envelope.arguments)) return null
  const schema = OLLAMA_TOOL_SCHEMA_CATALOG.find((tool) => tool.function.name === envelope.name)
  if (!schema || !schema.function.parameters.required.every((key) => Object.hasOwn(envelope.arguments as object, key))) return null
  return parseNativeToolCall(envelope.name, envelope.arguments as Record<string, unknown>)
}
