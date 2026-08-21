import { jsonrepair } from 'jsonrepair'
import { logger } from '../../../diagnostics'
import type { AgentToolCall } from './agentTypes'
import { validateAndSanitize, normalizeToolName } from './toolSchemaValidator'

export type { AgentToolCall }

function sanitizeAndParseJson(raw: string): any {
  if (!raw || !raw.trim()) return null

  // 1. Direct parse attempt for clean JSON
  try {
    return JSON.parse(raw)
  } catch (_) {
    // Fallback parsing strategy using jsonrepair for LLM outputs
  }

  try {
    let clean = raw.trim()

    // 1. Strip reasoning blocks (<think>...</think>, <thought>...</thought>)
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()

    // 2. Normalize Windows file paths with single backslashes (e.g. "filePath": "C:\Users\test" -> "C:\\Users\\test")
    clean = clean.replace(/("(?:filePath|path|dirPath|target_file|file_path|filename|destination)"\s*:\s*)"([^"]*)"/gi, (_m, keyPart, pathVal) => {
      const fixedSlashes = pathVal.replace(/(?<!\\)\\(?!\\)/g, '\\\\')
      return `${keyPart}"${fixedSlashes}"`
    })

    // 3. Battle-tested jsonrepair repairs unescaped newlines, trailing commas, single quotes, template strings, missing braces
    const repaired = jsonrepair(clean)
    return JSON.parse(repaired)
  } catch (err: any) {
    if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      logger.log('WARN', 'ToolParser', `Sanitized JSON parse failed: ${err.message}`)
    }
    return null
  }
}

function extractToolCallFromText(cleanText: string): AgentToolCall | null {
  if (!cleanText || typeof cleanText !== 'string') return null

  // 1. Check for JSON block enclosed in ```json ... ```, <tool_call>...</tool_call>, or generic ``` ... ```
  const toolCallMatch =
    cleanText.match(/<tool_call>([\s\S]*?)<\/tool_call>/i) ||
    cleanText.match(/```json\s*([\s\S]*?)\s*```/i) ||
    cleanText.match(/```\s*([\s\S]*?)\s*```/i)

  let jsonStr = toolCallMatch ? toolCallMatch[1].trim() : ''

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
      const lastBrace = cleanText.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = cleanText.slice(firstBrace, lastBrace + 1).trim()
      }
    }
  }

  // Auto-recover raw markdown shell code blocks (e.g. ```bash ... ``` or ```powershell ... ```)
  if (!jsonStr.startsWith('{')) {
    const bashMatch = cleanText.match(/```(?:bash|sh|powershell|cmd|shell|zsh)\s*([\s\S]*?)\s*```/i)
    if (bashMatch) {
      const rawCmd = bashMatch[1]
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .join('; ')
      if (rawCmd) {
        return {
          tool: 'run_command',
          parameters: { command: rawCmd },
          explanation: 'Extracted shell command from markdown code block',
        }
      }
    }
  }

  if (jsonStr) {
    const parsed = sanitizeAndParseJson(jsonStr)
    // Accept both the prompt-engineered "tool" key and the native / OpenAI-style
    // "name" key (used by tool-calling-capable models that echo their function
    // call as JSON text instead of populating the API's structured tool_calls).
    const rawToolName = parsed?.tool ?? (parsed?.arguments && typeof parsed?.name === 'string' ? parsed.name : undefined)
    if (parsed && typeof rawToolName === 'string') {
      const toolName = normalizeToolName(rawToolName)
      if (!toolName) return null

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
        return null
      }

      return validation.sanitizedToolCall
    }
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

  const shellBlockRegex = /```(?:bash|sh|powershell|cmd)\s*\n([\s\S]*?)```/gi
  const match = shellBlockRegex.exec(rawText)
  if (match) {
    const commands = match[1]
      .split('\n')
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

export function parseAgentToolCall(text: string): AgentToolCall | null {
  if (!text || typeof text !== 'string') return null

  // 1. First attempt: Strip <think>...</think> and <thought>...</thought> reasoning blocks
  const cleanText = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .trim()

  const hasThoughtBlocks = cleanText !== text.trim()

  const candidate =
    extractToolCallFromText(cleanText) ||
    (hasThoughtBlocks ? extractToolCallFromText(text) : null) ||
    parseFencedCodeBlockFallback(cleanText) ||
    (hasThoughtBlocks ? parseFencedCodeBlockFallback(text) : null) ||
    parseShellCodeBlockFallback(cleanText) ||
    (hasThoughtBlocks ? parseShellCodeBlockFallback(text) : null) ||
    parseDiffCodeBlockFallback(cleanText) ||
    (hasThoughtBlocks ? parseDiffCodeBlockFallback(text) : null)

  if (!candidate) return null

  const validated = validateAndSanitize(candidate)
  return validated.sanitizedToolCall
}
