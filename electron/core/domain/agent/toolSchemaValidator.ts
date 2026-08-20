import type { AgentToolCall, SupportedToolName } from './agentTypes'

export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  sanitizedToolCall: AgentToolCall
}

/**
 * Zero-dependency strict schema validator and parameter coercer for Agent tool payloads.
 */
export function validateAndSanitize(toolCall: AgentToolCall): SchemaValidationResult {
  const errors: string[] = []
  const rawParams = { ...(toolCall.parameters || {}) }
  const tool = toolCall.tool as SupportedToolName

  switch (tool) {
    case 'read_file': {
      const rawPath = rawParams.filePath || rawParams.path || rawParams.file || rawParams.target_file || rawParams.file_path || rawParams.filename || rawParams.TargetFile
      if (!rawPath) {
        errors.push("Missing required parameter 'filePath' for read_file")
      } else {
        rawParams.filePath = String(rawPath)
      }
      if (rawParams.startLine !== undefined) {
        const parsed = Number(rawParams.startLine)
        if (isNaN(parsed)) errors.push("Parameter 'startLine' must be a valid number")
        else rawParams.startLine = Math.max(1, Math.floor(parsed))
      }
      if (rawParams.endLine !== undefined) {
        const parsed = Number(rawParams.endLine)
        if (isNaN(parsed)) errors.push("Parameter 'endLine' must be a valid number")
        else rawParams.endLine = Math.max(1, Math.floor(parsed))
      }
      break
    }

    case 'write_file': {
      const rawPath = rawParams.filePath || rawParams.path || rawParams.file || rawParams.target_file || rawParams.file_path || rawParams.filename || rawParams.TargetFile || rawParams.destination || rawParams.save_as
      if (!rawPath) {
        errors.push("Missing required parameter 'filePath' for write_file")
      } else {
        rawParams.filePath = String(rawPath)
      }
      const rawContent = rawParams.content ?? rawParams.codeContent ?? rawParams.code ?? rawParams.text ?? rawParams.file_content ?? rawParams.data ?? rawParams.CodeContent
      if (rawContent === undefined) {
        rawParams.content = ''
      } else {
        rawParams.content = String(rawContent)
      }
      break
    }

    case 'replace_file_content': {
      const rawPath = rawParams.filePath || rawParams.path || rawParams.file || rawParams.target_file || rawParams.file_path || rawParams.filename || rawParams.TargetFile
      if (!rawPath) {
        errors.push("Missing required parameter 'filePath' for replace_file_content")
      } else {
        rawParams.filePath = String(rawPath)
      }
      const rawTarget = rawParams.targetContent ?? rawParams.target ?? rawParams.target_content ?? rawParams.old_content ?? rawParams.old_str ?? rawParams.old_text ?? rawParams.oldContent ?? rawParams.search_text ?? rawParams.searchText ?? rawParams.search ?? rawParams.find ?? rawParams.TargetContent
      if (rawTarget === undefined) {
        errors.push("Missing required parameter 'targetContent' for replace_file_content")
      } else {
        rawParams.targetContent = String(rawTarget)
      }
      const rawReplacement = rawParams.replacementContent ?? rawParams.replacement ?? rawParams.replacement_content ?? rawParams.new_content ?? rawParams.new_str ?? rawParams.new_text ?? rawParams.newContent ?? rawParams.replace_text ?? rawParams.replaceText ?? rawParams.replace ?? rawParams.to ?? rawParams.content ?? rawParams.code ?? rawParams.ReplacementContent
      if (rawReplacement === undefined) {
        errors.push("Missing required parameter 'replacementContent' for replace_file_content")
      } else {
        rawParams.replacementContent = String(rawReplacement)
      }
      break
    }

    case 'multi_replace_file_content': {
      const rawPath = rawParams.filePath || rawParams.path || rawParams.file || rawParams.target_file || rawParams.file_path || rawParams.filename || rawParams.TargetFile
      if (!rawPath) {
        errors.push("Missing required parameter 'filePath' for multi_replace_file_content")
      } else {
        rawParams.filePath = String(rawPath)
      }
      const rawChunks = Array.isArray(rawParams.replacements)
        ? rawParams.replacements
        : Array.isArray(rawParams.chunks)
        ? rawParams.chunks
        : Array.isArray(rawParams.replacement_chunks)
        ? rawParams.replacement_chunks
        : Array.isArray(rawParams.edits)
        ? rawParams.edits
        : []

      if (!Array.isArray(rawChunks) || rawChunks.length === 0) {
        errors.push("Missing or non-array parameter 'replacements' for multi_replace_file_content")
      } else {
        const normalized = rawChunks.map((c: any) => ({
          targetContent: String(c.targetContent ?? c.target ?? c.target_content ?? c.old_content ?? c.old_str ?? c.TargetContent ?? ''),
          replacementContent: String(c.replacementContent ?? c.replacement ?? c.replacement_content ?? c.new_content ?? c.new_str ?? c.ReplacementContent ?? ''),
        }))
        rawParams.replacements = normalized
        rawParams.chunks = normalized
      }
      break
    }

    case 'delete_file': {
      const rawPath = rawParams.filePath || rawParams.path || rawParams.file || rawParams.target_file || rawParams.file_path || rawParams.filename || rawParams.TargetFile
      if (!rawPath) {
        errors.push("Missing required parameter 'filePath' for delete_file")
      } else {
        rawParams.filePath = String(rawPath)
      }
      break
    }

    case 'list_dir': {
      if (!rawParams.dirPath && !rawParams.path) {
        rawParams.dirPath = '.'
      } else {
        rawParams.dirPath = String(rawParams.dirPath || rawParams.path)
      }
      break
    }

    case 'grep_search': {
      if (!rawParams.query && !rawParams.searchTerm) {
        errors.push("Missing required parameter 'query' for grep_search")
      } else {
        rawParams.query = String(rawParams.query || rawParams.searchTerm)
      }
      if (rawParams.dirPath) {
        rawParams.dirPath = String(rawParams.dirPath)
      }
      break
    }

    case 'run_command': {
      if (!rawParams.command && !rawParams.cmd) {
        errors.push("Missing required parameter 'command' for run_command")
      } else {
        rawParams.command = String(rawParams.command || rawParams.cmd)
      }
      if (rawParams.timeoutMs !== undefined) {
        const parsed = Number(rawParams.timeoutMs)
        rawParams.timeoutMs = isNaN(parsed) ? 60000 : Math.max(1000, parsed)
      }
      break
    }

    case 'git_status':
    case 'rollback_workspace':
    case 'rollback_last_step': {
      break
    }

    case 'git_commit': {
      if (!rawParams.commitMessage) {
        errors.push("Missing required parameter 'commitMessage' for git_commit")
      } else {
        rawParams.commitMessage = String(rawParams.commitMessage)
      }
      break
    }

    case 'run_tests': {
      if (rawParams.command) {
        rawParams.command = String(rawParams.command)
      }
      break
    }

    case 'git_diff': {
      if (rawParams.filePath) {
        rawParams.filePath = String(rawParams.filePath)
      }
      if (rawParams.staged !== undefined) {
        rawParams.staged = Boolean(rawParams.staged)
      }
      break
    }

    case 'get_file_info': {
      if (!rawParams.filePath && !rawParams.path) {
        errors.push("Missing required parameter 'filePath' for get_file_info")
      } else {
        rawParams.filePath = String(rawParams.filePath || rawParams.path)
      }
      break
    }

    case 'ensure_tool': {
      const rawTool = rawParams.toolName ?? rawParams.name ?? rawParams.tool
      if (rawTool === undefined || String(rawTool).trim() === '') {
        errors.push("Missing required parameter 'toolName' for ensure_tool")
      } else {
        rawParams.toolName = String(rawTool).trim()
      }
      break
    }

    case 'update_plan': {
      // Accept the aliases small models reach for (id / milestone / title) rather than
      // rejecting an otherwise well-formed plan update over a parameter name.
      const rawId = rawParams.milestoneId ?? rawParams.id ?? rawParams.milestone ?? rawParams.title
      if (rawId === undefined || String(rawId).trim() === '') {
        errors.push("Missing required parameter 'milestoneId' for update_plan")
      } else {
        rawParams.milestoneId = String(rawId).trim()
      }

      const VALID_STATUSES = ['pending', 'in_progress', 'verified', 'failed']
      const rawStatus = String(rawParams.status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
      if (!rawStatus) {
        errors.push("Missing required parameter 'status' for update_plan")
      } else if (!VALID_STATUSES.includes(rawStatus)) {
        errors.push(`Parameter 'status' must be one of: ${VALID_STATUSES.join(', ')}`)
      } else {
        rawParams.status = rawStatus
      }

      if (rawParams.notes !== undefined) {
        rawParams.notes = String(rawParams.notes)
      }
      break
    }

    case 'ask': {
      if (!rawParams.question && !rawParams.query) {
        errors.push("Missing required parameter 'question' for ask")
      } else {
        rawParams.question = String(rawParams.question || rawParams.query)
      }
      break
    }

    case 'finish': {
      if (rawParams.summary) {
        rawParams.summary = String(rawParams.summary)
      }
      break
    }

    default:
      // Generic safety string coercion for all other tools
      for (const k of Object.keys(rawParams)) {
        if (typeof rawParams[k] === 'object' && rawParams[k] !== null && !Array.isArray(rawParams[k])) {
          rawParams[k] = JSON.stringify(rawParams[k])
        }
      }
      break
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedToolCall: {
      ...toolCall,
      parameters: rawParams,
    },
  }
}
