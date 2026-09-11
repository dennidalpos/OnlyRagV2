import { jsonrepair } from 'jsonrepair'
import { logger } from '../../../diagnostics'
import type { AgentToolCall } from './agentTypes'
import { validateAndSanitize, normalizeToolName } from './toolSchemaValidator'

export type { AgentToolCall }

/** Why one candidate tool call was refused, so the caller can tell the model something useful. */
export interface ToolCallRejection {
  toolName: string
  errors: string[]
}

/** Notified for every candidate the validator refused. See parseAgentToolCall. */
export type ToolCallRejectionSink = (rejection: ToolCallRejection) => void

function sanitizeAndParseJson(raw: string): any {
  if (!raw || !raw.trim()) return null

  // Fast path for valid JSON.
  try {
    return JSON.parse(raw)
  } catch (_) {
    // Try repair for model output.
  }

  try {
    let clean = raw.trim()

    // Remove reasoning blocks before extraction.
    clean = clean.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').replace(/<thought>[\s\S]*?(?:<\/thought>|$)/gi, '').trim()

    // 2. Normalize Windows file paths with single backslashes (e.g. "filePath": "C:\Users\test" -> "C:\\Users\\test")
    clean = clean.replace(/("(?:filePath|path|dirPath|target_file|file_path|filename|destination)"\s*:\s*)"([^"]*)"/gi, (_m, keyPart, pathVal) => {
      const fixedSlashes = pathVal.replace(/(?<!\\)\\(?!\\)/g, '\\\\')
      return `${keyPart}"${fixedSlashes}"`
    })

    // Repair common model JSON errors.
    const repaired = jsonrepair(clean)
    return JSON.parse(repaired)
  } catch (err: any) {
    if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      logger.log('WARN', 'ToolParser', `Sanitized JSON parse failed: ${err.message}`)
    }
    return null
  }
}

/** Returns the balanced JSON object starting at `startIdx`, or null if truncated. */
function sliceBalancedObject(text: string, startIdx: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(startIdx, i + 1).trim()
    }
  }

  return null
}

function extractToolCallFromText(cleanText: string, onRejection?: ToolCallRejectionSink): AgentToolCall | null {
  if (!cleanText || typeof cleanText !== 'string') return null

  // Prefer fenced and tagged tool-call blocks.
  const toolCallMatch =
    cleanText.match(/<tool_call>([\s\S]*?)<\/tool_call>/i) ||
    cleanText.match(/```json\s*([\s\S]*?)\s*```/i) ||
    cleanText.match(/```\s*([\s\S]*?)\s*```/i)

  // Try the first candidate that validates.
  const candidates: string[] = []
  let jsonStr = toolCallMatch ? toolCallMatch[1].trim() : ''

  if (jsonStr) {
    candidates.push(jsonStr)
    const fencedFirstBrace = jsonStr.indexOf('{')
    if (fencedFirstBrace !== -1) {
      const balanced = sliceBalancedObject(jsonStr, fencedFirstBrace)
      if (balanced && balanced !== jsonStr) candidates.push(balanced)
    }
  }

  if (!jsonStr) {
    // Try finding raw JSON object containing "tool"/'tool' (prompt-engineered format)
    // or "name"+"arguments" together (native tool-calling / OpenAI function-call
    // format, e.g. Ollama /api/chat models that echo their call as
    // {"name": ..., "arguments": ...} text instead of populating message.tool_calls).
    // "name" alone is NOT sufficient — it's a common key in incidental JSON content
    // (e.g. package.json's "name" field shown inside a diff block) that isn't a tool call.
    const lowerText = cleanText.toLowerCase()
    const hasNativeCallShape = /"name"|'name'/.test(lowerText) && /"arguments"|'arguments'/.test(lowerText)
    const toolIdx = ['"tool"', "'tool'", ...(hasNativeCallShape ? ['"name"', "'name'"] : [])]
      .map((key) => lowerText.indexOf(key))
      .find((idx) => idx !== -1) ?? -1
    if (toolIdx !== -1) {
      const firstBrace = cleanText.lastIndexOf('{', toolIdx)
      if (firstBrace !== -1) {
        // The balanced object first: it is the only candidate that is correct when the model
        // emitted more than one call. The greedy span stays as the fallback for a truncated
        // object, where there is no matching brace to find.
        const balanced = sliceBalancedObject(cleanText, firstBrace)
        if (balanced) candidates.push(balanced)
        const lastBrace = cleanText.lastIndexOf('}')
        if (lastBrace > firstBrace) {
          const greedy = cleanText.slice(firstBrace, lastBrace + 1).trim()
          if (greedy !== balanced) candidates.push(greedy)
        }
      }
    }
  }

  for (const candidate of candidates) {
    const parsed = sanitizeAndParseJson(candidate)
    // Accept both the prompt-engineered "tool" key and the native / OpenAI-style
    // "name" key (used by tool-calling-capable models that echo their function
    // call as JSON text instead of populating the API's structured tool_calls).
    const rawToolName = parsed?.tool ?? (parsed?.arguments && typeof parsed?.name === 'string' ? parsed.name : undefined)
    if (!parsed || typeof rawToolName !== 'string') continue

    const toolName = normalizeToolName(rawToolName)
    if (!toolName) continue

    const rawParams: Record<string, any> = {
      ...parsed,
      ...(parsed.parameters || parsed.arguments || parsed.args || parsed.params || {}),
    }

    const candidateCall: AgentToolCall = {
      tool: toolName,
      parameters: rawParams,
      explanation: parsed.explanation || parsed.reason || parsed.summary || parsed.thought,
    }

    const validation = validateAndSanitize(candidateCall)
    if (!validation.valid) {
      logger.log('WARN', 'ToolParser', `Rejected ${toolName} call: ${validation.errors.join('; ')}`)
      onRejection?.({ toolName: String(toolName), errors: validation.errors })
      continue
    }

    return validation.sanitizedToolCall
  }

  return null
}

function parseFencedCodeBlockFallback(rawText: string): AgentToolCall | null {
  if (!rawText || typeof rawText !== 'string') return null

  const codeBlockRegex = /```(?:[a-zA-Z0-9_\-\.]+)?\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(rawText)) !== null) {
    const blockContent = match[1]
    const firstLine = blockContent.split('\n')[0].trim()

    const filenameMatch =
      firstLine.match(/^<!--\s*([a-zA-Z0-9_\-\.\/\\\s]+\.[a-zA-Z0-9_]+)\s*-->/i) ||
      firstLine.match(/^\/\/\s*(?:file(?:name)?:\s*)?([a-zA-Z0-9_\-\.\/\\\s]+\.[a-zA-Z0-9_]+)/i) ||
      firstLine.match(/^\/\*\s*(?:file(?:name)?:\s*)?([a-zA-Z0-9_\-\.\/\\\s]+\.[a-zA-Z0-9_]+)\s*\*\//i) ||
      firstLine.match(/^#\s*(?:file(?:name)?:\s*)?([a-zA-Z0-9_\-\.\/\\\s]+\.[a-zA-Z0-9_]+)/i) ||
      firstLine.match(/^(?:File(?:name)?|Path):\s*([a-zA-Z0-9_\-\.\/\\\s]+\.[a-zA-Z0-9_]+)/i)

    if (filenameMatch) {
      const filePath = filenameMatch[1].trim()
      if (filePath && blockContent.trim().length > 0) {
        return {
          tool: 'write_file',
          parameters: {
            filePath,
            content: blockContent.trim(),
          },
          explanation: `Creating file ${filePath}`,
        }
      }
    }
  }

  return null
}

function parseShellCodeBlockFallback(rawText: string): AgentToolCall | null {
  if (!rawText || typeof rawText !== 'string') return null

  const shellBlockRegex = /```(?:bash|sh|powershell|cmd|shell|zsh)\s*\n?([\s\S]*?)```/gi
  const match = shellBlockRegex.exec(rawText)
  if (match) {
    const commands = match[1]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
      .join('; ')

    if (commands) {
      return {
        tool: 'run_command',
        parameters: { command: commands },
        explanation: `Executing shell commands: ${commands.slice(0, 80)}`,
      }
    }
  }

  return null
}

function parseDiffCodeBlockFallback(rawText: string): AgentToolCall | null {
  if (!rawText || typeof rawText !== 'string') return null

  const diffMatch = rawText.match(/(?:([\s\S]*?))?<<<<<<<\s*SEARCH\s*\r?\n?([\s\S]*?)\r?\n?=======\r?\n?([\s\S]*?)\r?\n?>>>>>>>\s*REPLACE/i)
  if (diffMatch) {
    const precedingText = (diffMatch[1] || '').trim()
    let filePath = ''
    const lines = precedingText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length > 0) {
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        const cleanLine = line.replace(/^(?:File(?:name)?|Path|Create|Update|Edit|Write):\s*/i, '').trim()
        const fileMatch = cleanLine.match(/([a-zA-Z0-9_\-\.\/\\\s]+\.[a-zA-Z0-9_]+)/)
        if (fileMatch) {
          filePath = fileMatch[1].trim()
          break
        }
      }
    }

    const targetContent = diffMatch[2]
    const replacementContent = diffMatch[3]
    if (targetContent !== undefined) {
      if (targetContent.trim() === '' && filePath) {
        return {
          tool: 'write_file',
          parameters: {
            filePath,
            content: replacementContent || '',
          },
          explanation: `Creating file ${filePath} via diff block fallback`,
        }
      }

      return {
        tool: 'replace_file_content',
        parameters: {
          filePath: filePath || 'file',
          targetContent,
          replacementContent: replacementContent || '',
        },
        explanation: `Replacing content in ${filePath || 'file'}`,
      }
    }
  }

  return null
}

/**
 * Parses the model's turn into a tool call, or null when none survives validation.
 *
 * `onRejection` is how the caller learns WHY. Without it a refused call is indistinguishable
 * from a turn that contained no tool call at all, and the model was told only that "mandatory
 * input parameters were missing or malformed" — see buildToolSchemaCorrectionDirective.
 */
export function parseAgentToolCall(text: string, onRejection?: ToolCallRejectionSink): AgentToolCall | null {
  if (!text || typeof text !== 'string') return null

  // Ignore tool-call examples inside reasoning traces.
  const cleanText = text
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
    .replace(/<thought>[\s\S]*?(?:<\/thought>|$)/gi, '')
    .trim()

  const candidate =
    extractToolCallFromText(cleanText, onRejection) ||
    parseFencedCodeBlockFallback(cleanText) ||
    parseShellCodeBlockFallback(cleanText) ||
    parseDiffCodeBlockFallback(cleanText)

  if (!candidate) return null

  const validated = validateAndSanitize(candidate)
  if (!validated.valid) {
    onRejection?.({ toolName: String(candidate.tool), errors: validated.errors })
    return null
  }
  return validated.sanitizedToolCall
}
