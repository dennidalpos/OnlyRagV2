import type { AgentToolCall } from './agentTypes'
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
