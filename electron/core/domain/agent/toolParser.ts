import { logger } from '../../../diagnostics'
import type { AgentToolCall, SupportedToolName, AgentToolReplacementChunk } from './agentTypes'

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

    // Strip <think>...</think> and <thought>...</thought> reasoning blocks if present
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()

    // Fix unescaped Windows file path backslashes (e.g., C:\path\to\file -> C:\\path\\to\\file)
    clean = clean.replace(/\\(?!["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\')

    // Fix trailing commas before closing braces/brackets across multi-line strings
    clean = clean.replace(/,\s*([}\]])/g, '$1')

    // Fix single quoted keys e.g. {'tool': ...} -> {"tool": ...}
    clean = clean.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":')

    // Fix single quoted values e.g. "tool": 'read_file' -> "tool": "read_file"
    clean = clean.replace(/:\s*'([^']*)'/g, ':"$1"')

    // Fix unescaped control newlines inside quotes
    clean = clean.replace(/("(?:[^"\\]|\\.)*")/g, (match) => {
      return match.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t')
    })

    return JSON.parse(clean)
  } catch (err: any) {
    logger.log('WARN', 'ToolParser', `Sanitized JSON parse failed: ${err.message}`)
    return null
  }
}

export function parseAgentToolCall(text: string): AgentToolCall | null {
  if (!text || typeof text !== 'string') return null

  // 1. Check for JSON block enclosed in ```json ... ```, <tool_call>...</tool_call>, or generic ``` ... ```
  const toolCallMatch =
    text.match(/<tool_call>([\s\S]*?)<\/tool_call>/i) ||
    text.match(/```json\s*([\s\S]*?)\s*```/i) ||
    text.match(/```\s*([\s\S]*?)\s*```/i)

  let jsonStr = toolCallMatch ? toolCallMatch[1].trim() : ''

  if (!jsonStr) {
    // Try finding raw JSON object containing "tool" or 'tool' key
    const toolIdx = text.toLowerCase().indexOf('"tool"') !== -1 ? text.toLowerCase().indexOf('"tool"') : text.toLowerCase().indexOf("'tool'")
    if (toolIdx !== -1) {
      const firstBrace = text.lastIndexOf('{', toolIdx)
      const lastBrace = text.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = text.slice(firstBrace, lastBrace + 1).trim()
      }
    }
  }

  if (jsonStr) {
    const parsed = sanitizeAndParseJson(jsonStr)
    if (parsed && typeof parsed.tool === 'string') {
      let toolName = parsed.tool.toLowerCase().trim()

      if (toolName === 'readfile' || toolName === 'read' || toolName === 'view_file' || toolName === 'view_file_slice') toolName = 'read_file'
      if (toolName === 'writefile' || toolName === 'write' || toolName === 'create_file') toolName = 'write_file'
      if (toolName === 'replace_content' || toolName === 'replace_chunk' || toolName === 'edit_file') toolName = 'replace_file_content'
      if (toolName === 'multi_replace' || toolName === 'replace_multiple' || toolName === 'multi_replace_content' || toolName === 'multi_edit') toolName = 'multi_replace_file_content'
      if (toolName === 'delete_file' || toolName === 'remove_file' || toolName === 'unlink' || toolName === 'delete' || toolName === 'del_file') toolName = 'delete_file'
      if (toolName === 'grep' || toolName === 'search' || toolName === 'search_files' || toolName === 'find_in_files') toolName = 'grep_search'
      if (toolName === 'list' || toolName === 'ls' || toolName === 'listdir' || toolName === 'list_files') toolName = 'list_dir'
      if (toolName === 'web_search' || toolName === 'search_web' || toolName === 'google' || toolName === 'duckduckgo' || toolName === 'web' || toolName === 'search_internet') toolName = 'web_search'
      if (toolName === 'fetch_web_content' || toolName === 'fetch_url' || toolName === 'read_url' || toolName === 'web_fetch' || toolName === 'read_web_page' || toolName === 'browse' || toolName === 'get_url') toolName = 'fetch_web_content'
      if (toolName === 'download_file' || toolName === 'download' || toolName === 'fetch_file' || toolName === 'download_asset' || toolName === 'save_url') toolName = 'download_file'
      if (toolName === 'runcommand' || toolName === 'terminal' || toolName === 'exec' || toolName === 'powershell' || toolName === 'exec_command' || toolName === 'cmd') toolName = 'run_command'
      if (toolName === 'inspect_os' || toolName === 'os_env' || toolName === 'system_info') toolName = 'inspect_os_env'
      if (toolName === 'complete' || toolName === 'done' || toolName === 'finish_task' || toolName === 'stop') toolName = 'finish'

      const rawParams = parsed.parameters || parsed.args || parsed.params || {}
      const parameters: Record<string, any> = { ...rawParams }

      if (!parameters.filePath) {
        parameters.filePath = rawParams.path || rawParams.file || rawParams.target_file || rawParams.file_path || rawParams.filename || rawParams.targetPath || rawParams.destination || rawParams.save_as || rawParams.TargetFile
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
        parameters.command = rawParams.cmd || rawParams.terminal_command || rawParams.exec || rawParams.command_line || rawParams.CommandLine
      }
      if (!parameters.content) {
        parameters.content = rawParams.code || rawParams.text || rawParams.file_content || rawParams.data || rawParams.CodeContent
      }
      if (!parameters.query) {
        parameters.query = rawParams.pattern || rawParams.search || rawParams.term || rawParams.keyword || rawParams.search_query || rawParams.q || rawParams.Query
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
