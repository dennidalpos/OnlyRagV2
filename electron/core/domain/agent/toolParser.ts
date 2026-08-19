import { logger } from '../../../diagnostics'
import type { AgentToolCall, SupportedToolName, AgentToolReplacementChunk } from './agentTypes'
import { ToolSchemaValidator } from './toolSchemaValidator'

export type { AgentToolCall }

function sanitizeAndParseJson(raw: string): any {
  if (!raw || !raw.trim()) return null

  // First attempt direct parse
  try {
    return JSON.parse(raw)
  } catch (_) {
    // Fallback parsing strategy for heavily quantized LLM outputs
  }

  try {
    let clean = raw.trim()

    // 1. Strip <think>...</think> and <thought>...</thought> reasoning blocks if present
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()

    // 2. Convert JS backtick-quoted template literal values: "key": `value` or key: `value`
    clean = clean.replace(/:\s*`([\s\S]*?)`(?=\s*[,}\]])/g, (_match, p1) => {
      const escaped = p1
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/\t/g, '\\t')
      return `: "${escaped}"`
    })

    // 3. Fix unescaped control newlines, carriage returns, and tabs inside double-quoted strings
    clean = clean.replace(/("(?:[^"\\]|\\.)*")/gs, (match) => {
      return match.replace(/\r\n|\r|\n/g, '\\n').replace(/\t/g, '\\t')
    })

    // 4. Fix lone single backslashes in path fields (e.g. C:\Users\test_app -> C:\\Users\\test_app)
    clean = clean.replace(/("(?:filePath|path|dirPath|target_file|file_path|filename|destination)"\s*:\s*)"([^"]*)"/gi, (_m, keyPart, pathVal) => {
      const fixedSlashes = pathVal.replace(/(?<!\\)\\(?!\\)/g, '\\\\')
      return `${keyPart}"${fixedSlashes}"`
    })

    // 5. Fix remaining lone unescaped backslashes across JSON without corrupting existing \\
    clean = clean.replace(/(?<!\\)\\(?!["\\\/bfnrt]|u[0-9a-fA-F]{4}|\\)/g, '\\\\')

    // 6. Fix trailing commas before closing braces/brackets across multi-line strings
    clean = clean.replace(/,\s*([}\]])/g, '$1')

    // 7. Fix single quoted keys e.g. {'tool': ...} -> {"tool": ...}
    clean = clean.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":')

    // 8. Fix single quoted values e.g. "tool": 'read_file' -> "tool": "read_file"
    clean = clean.replace(/:\s*'([^']*)'/g, ':"$1"')

    return JSON.parse(clean)
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
    // "name" is only trusted alongside a sibling "arguments" object — "name" alone
    // is too common in incidental JSON (e.g. a package.json snippet) to signal a tool call.
    const rawToolName = parsed?.tool ?? (parsed?.arguments && typeof parsed?.name === 'string' ? parsed.name : undefined)
    if (parsed && typeof rawToolName === 'string') {
      let toolName = rawToolName.toLowerCase().trim()

      if (toolName === 'readfile' || toolName === 'read' || toolName === 'view_file' || toolName === 'view_file_slice' || toolName === 'open_file' || toolName === 'cat') toolName = 'read_file'
      if (toolName === 'extract_code_symbols' || toolName === 'extract_symbols' || toolName === 'code_symbols' || toolName === 'symbols' || toolName === 'find_symbols' || toolName === 'get_symbols' || toolName === 'list_symbols') toolName = 'extract_code_symbols'
      if (toolName === 'writefile' || toolName === 'write' || toolName === 'create_file' || toolName === 'write_code' || toolName === 'save_file' || toolName === 'write_to_file' || toolName === 'put_file') toolName = 'write_file'
      if (toolName === 'replace_content' || toolName === 'replace_chunk' || toolName === 'edit_file' || toolName === 'replace_file' || toolName === 'modify_file' || toolName === 'update_file' || toolName === 'patch_file') toolName = 'replace_file_content'
      if (toolName === 'multi_replace' || toolName === 'replace_multiple' || toolName === 'multi_replace_content' || toolName === 'multi_edit' || toolName === 'batch_replace') toolName = 'multi_replace_file_content'
      if (toolName === 'delete_file' || toolName === 'remove_file' || toolName === 'unlink' || toolName === 'delete' || toolName === 'del_file' || toolName === 'rm') toolName = 'delete_file'
      if (toolName === 'grep' || toolName === 'search' || toolName === 'search_files' || toolName === 'find_in_files' || toolName === 'search_in_files' || toolName === 'grep_files' || toolName === 'search_code' || toolName === 'find_text') toolName = 'grep_search'
      if (toolName === 'create_directory' || toolName === 'mkdir' || toolName === 'make_directory' || toolName === 'create_folder' || toolName === 'ensure_dir') toolName = 'create_directory'
      if (toolName === 'copy_file' || toolName === 'copy' || toolName === 'cp' || toolName === 'duplicate_file') toolName = 'copy_file'
      if (toolName === 'move_file' || toolName === 'move' || toolName === 'mv' || toolName === 'rename_file' || toolName === 'rename') toolName = 'move_file'
      if (toolName === 'list_files_recursive' || toolName === 'find_files' || toolName === 'tree' || toolName === 'list_files_tree' || toolName === 'file_tree') toolName = 'list_files_recursive'
      if (toolName === 'list' || toolName === 'ls' || toolName === 'listdir' || toolName === 'list_files' || toolName === 'list_directory' || toolName === 'dir') toolName = 'list_dir'
      if (toolName === 'web_search' || toolName === 'search_web' || toolName === 'google' || toolName === 'duckduckgo' || toolName === 'web' || toolName === 'search_internet' || toolName === 'bing') toolName = 'web_search'
      if (toolName === 'fetch_web_content' || toolName === 'fetch_url' || toolName === 'read_url' || toolName === 'web_fetch' || toolName === 'read_web_page' || toolName === 'browse' || toolName === 'get_url' || toolName === 'read_url_content' || toolName === 'fetch_web') toolName = 'fetch_web_content'
      if (toolName === 'download_file' || toolName === 'download' || toolName === 'fetch_file' || toolName === 'download_asset' || toolName === 'save_url') toolName = 'download_file'
      if (toolName === 'runcommand' || toolName === 'terminal' || toolName === 'exec' || toolName === 'powershell' || toolName === 'exec_command' || toolName === 'cmd' || toolName === 'run_cmd' || toolName === 'execute_command' || toolName === 'shell' || toolName === 'bash') toolName = 'run_command'
      if (toolName === 'inspect_os' || toolName === 'os_env' || toolName === 'system_info' || toolName === 'system_environment') toolName = 'inspect_os_env'
      if (toolName === 'git_status' || toolName === 'gitstatus' || toolName === 'status_git' || toolName === 'git_state') toolName = 'git_status'
      if (toolName === 'git_diff' || toolName === 'gitdiff' || toolName === 'git_changes' || toolName === 'diff') toolName = 'git_diff'
      if (toolName === 'rollback_last_step' || toolName === 'undo_last_step' || toolName === 'undo_step' || toolName === 'revert_last_step') toolName = 'rollback_last_step'
      if (toolName === 'rollback_workspace' || toolName === 'rollback' || toolName === 'undo' || toolName === 'undo_changes' || toolName === 'revert_workspace') toolName = 'rollback_workspace'
      if (toolName === 'get_file_info' || toolName === 'file_info' || toolName === 'stat_file' || toolName === 'file_stats' || toolName === 'file_metadata') toolName = 'get_file_info'
      if (toolName === 'ask' || toolName === 'ask_question' || toolName === 'question' || toolName === 'clarify' || toolName === 'user_input' || toolName === 'prompt_user' || toolName === 'inquire') toolName = 'ask'
      if (toolName === 'complete' || toolName === 'done' || toolName === 'finish_task' || toolName === 'stop' || toolName === 'end_task') toolName = 'finish'

      const rawParams: Record<string, any> = {
        ...parsed,
        ...(parsed.parameters || parsed.arguments || parsed.args || parsed.params || {}),
      }
      const parameters: Record<string, any> = { ...rawParams }

      if (!parameters.filePath) {
        parameters.filePath = rawParams.path || rawParams.file || rawParams.target_file || rawParams.file_path || rawParams.filename || rawParams.targetPath || rawParams.destination || rawParams.save_as || rawParams.TargetFile
      }
      if (!parameters.sourcePath) {
        parameters.sourcePath = rawParams.source || rawParams.src || rawParams.from || rawParams.source_path || rawParams.filePath || rawParams.path
      }
      if (!parameters.targetPath) {
        parameters.targetPath = rawParams.target || rawParams.dest || rawParams.destination || rawParams.to || rawParams.target_path || rawParams.new_path || rawParams.newPath
      }
      if (!parameters.dirPath) {
        parameters.dirPath = rawParams.path || rawParams.dir || rawParams.directory || rawParams.dir_path || rawParams.folder
      }
      if (!parameters.url) {
        parameters.url = rawParams.link || rawParams.href || rawParams.endpoint || rawParams.Url || rawParams.URL
      }
      if (!parameters.targetContent) {
        parameters.targetContent = rawParams.target || rawParams.target_content || rawParams.old_content || rawParams.old_str || rawParams.search_text || rawParams.TargetContent
      }
      if (!parameters.replacementContent) {
        parameters.replacementContent = rawParams.replacement || rawParams.replacement_content || rawParams.new_content || rawParams.new_str || rawParams.replace_text || rawParams.ReplacementContent
      }
      if (!parameters.command) {
        const rawCmd = rawParams.cmd || rawParams.terminal_command || rawParams.exec || rawParams.command_line || rawParams.CommandLine || parsed.parameters
        if (Array.isArray(rawCmd)) {
          parameters.command = rawCmd.filter((c: any) => typeof c === 'string' && c.trim()).join('; ')
        } else if (typeof rawCmd === 'string') {
          parameters.command = rawCmd
        }
      } else if (Array.isArray(parameters.command)) {
        parameters.command = parameters.command.filter((c: any) => typeof c === 'string' && c.trim()).join('; ')
      }

      if (!parameters.content) {
        parameters.content = rawParams.code || rawParams.text || rawParams.file_content || rawParams.data || rawParams.CodeContent
      }
      if (!parameters.query) {
        parameters.query = rawParams.pattern || rawParams.search || rawParams.term || rawParams.keyword || rawParams.search_query || rawParams.q || rawParams.Query
      }
      if (!parameters.question) {
        parameters.question = rawParams.question || rawParams.query || rawParams.prompt || rawParams.message || rawParams.text || parsed.explanation || parsed.reason || ''
      }

      // Line slice parsing
      if (parameters.startLine === undefined && rawParams.start_line !== undefined) {
        parameters.startLine = Number(rawParams.start_line)
      } else if (parameters.startLine !== undefined) {
        parameters.startLine = Number(parameters.startLine)
      }
      if (parameters.endLine === undefined && rawParams.end_line !== undefined) {
        parameters.endLine = Number(rawParams.end_line)
      } else if (parameters.endLine !== undefined) {
        parameters.endLine = Number(parameters.endLine)
      }

      // Multi-replace chunk normalization
      const rawChunks = rawParams.replacements || rawParams.replacement_chunks || rawParams.chunks || rawParams.ReplacementChunks || rawParams.edits
      if (Array.isArray(rawChunks)) {
        parameters.replacements = rawChunks
          .map((chunk: any) => ({
            targetContent: chunk.targetContent || chunk.target || chunk.target_content || chunk.old_content || chunk.TargetContent || '',
            replacementContent: chunk.replacementContent || chunk.replacement || chunk.replacement_content || chunk.new_content || chunk.ReplacementContent || '',
          }))
          .filter((chunk: AgentToolReplacementChunk) => chunk.targetContent)
      }

      // Input parameter validations for individual tools
      if (toolName === 'read_file' && (!parameters.filePath || typeof parameters.filePath !== 'string')) {
        logger.log('WARN', 'ToolParser', 'Rejected read_file call: missing required filePath')
        return null
      }
      if (toolName === 'extract_code_symbols' && (!parameters.filePath || typeof parameters.filePath !== 'string')) {
        logger.log('WARN', 'ToolParser', 'Rejected extract_code_symbols call: missing required filePath')
        return null
      }
      if (toolName === 'write_file' && (!parameters.filePath || typeof parameters.filePath !== 'string')) {
        logger.log('WARN', 'ToolParser', 'Rejected write_file call: missing required filePath')
        return null
      }
      if (toolName === 'delete_file' && (!parameters.filePath || typeof parameters.filePath !== 'string')) {
        logger.log('WARN', 'ToolParser', 'Rejected delete_file call: missing required filePath')
        return null
      }
      if (toolName === 'replace_file_content' && (!parameters.filePath || !parameters.targetContent)) {
        logger.log('WARN', 'ToolParser', 'Rejected replace_file_content call: missing required filePath or targetContent')
        return null
      }
      if (toolName === 'multi_replace_file_content' && (!parameters.filePath || !Array.isArray(parameters.replacements) || parameters.replacements.length === 0)) {
        logger.log('WARN', 'ToolParser', 'Rejected multi_replace_file_content call: missing required filePath or valid replacements array')
        return null
      }
      if (toolName === 'web_search' && (!parameters.query || typeof parameters.query !== 'string')) {
        logger.log('WARN', 'ToolParser', 'Rejected web_search call: missing required query parameter')
        return null
      }
      if (toolName === 'fetch_web_content' && (!parameters.url || typeof parameters.url !== 'string')) {
        logger.log('WARN', 'ToolParser', 'Rejected fetch_web_content call: missing required url parameter')
        return null
      }
      if (toolName === 'download_file' && (!parameters.url || !parameters.filePath)) {
        logger.log('WARN', 'ToolParser', 'Rejected download_file call: missing required url or filePath')
        return null
      }
      if (toolName === 'run_command' && (!parameters.command || typeof parameters.command !== 'string')) {
        logger.log('WARN', 'ToolParser', 'Rejected run_command call: missing required command parameter')
        return null
      }
      if (toolName === 'grep_search' && (!parameters.query || typeof parameters.query !== 'string')) {
        logger.log('WARN', 'ToolParser', 'Rejected grep_search call: missing required query parameter')
        return null
      }
      if (toolName === 'list_dir' && !parameters.dirPath) {
        parameters.dirPath = '.'
      }

      return {
        tool: toolName as SupportedToolName,
        parameters,
        explanation: parsed.explanation || parsed.reason || parsed.summary || parsed.thought,
      }
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

  const candidate =
    extractToolCallFromText(cleanText) ||
    extractToolCallFromText(text) ||
    parseFencedCodeBlockFallback(cleanText) ||
    parseFencedCodeBlockFallback(text) ||
    parseShellCodeBlockFallback(cleanText) ||
    parseShellCodeBlockFallback(text) ||
    parseDiffCodeBlockFallback(cleanText) ||
    parseDiffCodeBlockFallback(text)

  if (!candidate) return null

  const validated = ToolSchemaValidator.validateAndSanitize(candidate)
  return validated.sanitizedToolCall
}
