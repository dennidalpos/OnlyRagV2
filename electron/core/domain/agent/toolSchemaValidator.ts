/**
 * electron/core/domain/agent/toolSchemaValidator.ts
 *
 * Domain Layer — Declarative Schema Validation and Parameter Coercion for Agent Tools.
 * Single source of truth for tool name aliases, parameter normalization, and input validation.
 */

import type { AgentToolCall, SupportedToolName, AgentToolReplacementChunk } from './agentTypes'
import { findToolSchema } from './ollamaToolSchemaCatalog'

export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  sanitizedToolCall: AgentToolCall
}

const TOOL_NAME_ALIASES: Record<string, SupportedToolName> = {
  readfile: 'read_file',
  read: 'read_file',
  view_file: 'read_file',
  view_file_slice: 'read_file',
  open_file: 'read_file',
  cat: 'read_file',
  extract_code_symbols: 'extract_code_symbols',
  extract_symbols: 'extract_code_symbols',
  code_symbols: 'extract_code_symbols',
  symbols: 'extract_code_symbols',
  find_symbols: 'extract_code_symbols',
  get_symbols: 'extract_code_symbols',
  list_symbols: 'extract_code_symbols',
  writefile: 'write_file',
  write: 'write_file',
  create_file: 'write_file',
  write_code: 'write_file',
  save_file: 'write_file',
  write_to_file: 'write_file',
  put_file: 'write_file',
  replace_content: 'replace_file_content',
  replace_chunk: 'replace_file_content',
  edit_file: 'replace_file_content',
  replace_file: 'replace_file_content',
  modify_file: 'replace_file_content',
  update_file: 'replace_file_content',
  patch_file: 'replace_file_content',
  multi_replace: 'multi_replace_file_content',
  replace_multiple: 'multi_replace_file_content',
  multi_replace_content: 'multi_replace_file_content',
  multi_edit: 'multi_replace_file_content',
  batch_replace: 'multi_replace_file_content',
  delete_file: 'delete_file',
  remove_file: 'delete_file',
  unlink: 'delete_file',
  delete: 'delete_file',
  del_file: 'delete_file',
  rm: 'delete_file',
  grep: 'grep_search',
  search: 'grep_search',
  search_files: 'grep_search',
  find_in_files: 'grep_search',
  search_in_files: 'grep_search',
  grep_files: 'grep_search',
  search_code: 'grep_search',
  find_text: 'grep_search',
  create_directory: 'create_directory',
  mkdir: 'create_directory',
  make_directory: 'create_directory',
  create_folder: 'create_directory',
  ensure_dir: 'create_directory',
  copy_file: 'copy_file',
  copy: 'copy_file',
  cp: 'copy_file',
  duplicate_file: 'copy_file',
  move_file: 'move_file',
  move: 'move_file',
  mv: 'move_file',
  rename_file: 'move_file',
  rename: 'move_file',
  list_files_recursive: 'list_files_recursive',
  find_files: 'list_files_recursive',
  tree: 'list_files_recursive',
  list_files_tree: 'list_files_recursive',
  file_tree: 'list_files_recursive',
  list: 'list_dir',
  ls: 'list_dir',
  listdir: 'list_dir',
  list_files: 'list_dir',
  list_directory: 'list_dir',
  dir: 'list_dir',
  web_search: 'web_search',
  search_web: 'web_search',
  google: 'web_search',
  duckduckgo: 'web_search',
  web: 'web_search',
  search_internet: 'web_search',
  bing: 'web_search',
  fetch_web_content: 'fetch_web_content',
  fetch_url: 'fetch_web_content',
  read_url: 'fetch_web_content',
  web_fetch: 'fetch_web_content',
  read_web_page: 'fetch_web_content',
  browse: 'fetch_web_content',
  get_url: 'fetch_web_content',
  read_url_content: 'fetch_web_content',
  fetch_web: 'fetch_web_content',
  download_file: 'download_file',
  download: 'download_file',
  fetch_file: 'download_file',
  download_asset: 'download_file',
  save_url: 'download_file',
  runcommand: 'run_command',
  terminal: 'run_command',
  exec: 'run_command',
  powershell: 'run_command',
  exec_command: 'run_command',
  cmd: 'run_command',
  run_cmd: 'run_command',
  execute_command: 'run_command',
  shell: 'run_command',
  bash: 'run_command',
  inspect_os: 'inspect_os_env',
  os_env: 'inspect_os_env',
  system_info: 'inspect_os_env',
  system_environment: 'inspect_os_env',
  git_status: 'git_status',
  gitstatus: 'git_status',
  status_git: 'git_status',
  git_state: 'git_status',
  git_diff: 'git_diff',
  gitdiff: 'git_diff',
  git_changes: 'git_diff',
  diff: 'git_diff',
  rollback_last_step: 'rollback_last_step',
  undo_last_step: 'rollback_last_step',
  undo_step: 'rollback_last_step',
  revert_last_step: 'rollback_last_step',
  rollback_workspace: 'rollback_workspace',
  rollback: 'rollback_workspace',
  undo: 'rollback_workspace',
  undo_changes: 'rollback_workspace',
  revert_workspace: 'rollback_workspace',
  get_file_info: 'get_file_info',
  file_info: 'get_file_info',
  stat_file: 'get_file_info',
  file_stats: 'get_file_info',
  file_metadata: 'get_file_info',
  ask: 'ask',
  ask_question: 'ask',
  question: 'ask',
  clarify: 'ask',
  user_input: 'ask',
  prompt_user: 'ask',
  inquire: 'ask',
  complete: 'finish',
  done: 'finish',
  finish_task: 'finish',
  stop: 'finish',
  end_task: 'finish',
}

/**
 * What a `write_file` call is actually asking for, read from the shape of its arguments.
 *
 * A path ending in a separator names a directory, not a file — every filesystem and every
 * shell agrees on that, so it is a reading rather than a guess. `write_file` used to take the
 * path as an opaque string: in coding_agent_audit.log session-1787562597025-q8a5 the model
 * called `write_file("src/services/", "")` to satisfy the milestone "Create `src/services/`
 * directory", and the tool answered "Successfully wrote file src/services/" after creating a
 * zero-byte FILE named `services`. Nothing downstream could then put anything inside it.
 *
 *  - `directory`   — separator-terminated with no content: create the directory instead.
 *  - `contradictory` — separator-terminated WITH content: a file cannot be a directory, and
 *                      which of the two the model meant is genuinely unknown. Refuse and say so.
 *  - `file`        — everything else, handled as before.
 */
export type WriteFileTargetKind = 'file' | 'directory' | 'contradictory'

export function classifyWriteFileTarget(filePath: string | undefined, content: string): WriteFileTargetKind {
  const raw = typeof filePath === 'string' ? filePath.trim() : ''
  if (!raw || !/[\\/]$/.test(raw)) return 'file'
  return (content || '').trim() ? 'contradictory' : 'directory'
}

/**
 * Normalizes tool name alias to canonical SupportedToolName.
 */
export function normalizeToolName(rawName?: string): SupportedToolName | null {
  if (!rawName || typeof rawName !== 'string') return null
  const cleaned = rawName.toLowerCase().trim()
  return TOOL_NAME_ALIASES[cleaned] || (cleaned as SupportedToolName)
}

/**
 * Normalizes raw parameter dictionary, mapping alias keys to canonical names.
 */
export function normalizeToolParams(raw: Record<string, any>): Record<string, any> {
  if (!raw || typeof raw !== 'object') return {}
  const p: Record<string, any> = { ...raw }

  // 1. Path aliases
  if (!p.filePath) {
    p.filePath = p.path || p.file || p.target_file || p.file_path || p.filename || p.targetPath || p.destination || p.save_as || p.TargetFile
  }
  if (!p.sourcePath) {
    p.sourcePath = p.source || p.src || p.from || p.source_path || p.filePath || p.path
  }
  if (!p.targetPath) {
    p.targetPath = p.target || p.dest || p.destination || p.to || p.target_path || p.new_path || p.newPath
  }
  if (!p.dirPath) {
    p.dirPath = p.path || p.dir || p.directory || p.dir_path || p.folder
  }
  if (!p.url) {
    p.url = p.link || p.href || p.endpoint || p.Url || p.URL
  }

  // 2. Content & Edit aliases
  if (!p.targetContent) {
    p.targetContent = p.target || p.target_content || p.old_content || p.old_str || p.old_text || p.oldContent || p.search_text || p.searchText || p.search || p.find || p.TargetContent
  }
  if (!p.replacementContent) {
    p.replacementContent = p.replacement || p.replacement_content || p.new_content || p.new_str || p.new_text || p.newContent || p.replace_text || p.replaceText || p.replace || p.to || p.content || p.code || p.ReplacementContent
  }
  if (p.content === undefined) {
    const rawContent = p.code || p.text || p.file_content || p.data || p.CodeContent
    if (rawContent !== undefined) p.content = rawContent
  }

  // 3. Query, Command & Question
  if (!p.query) {
    p.query = p.pattern || p.search || p.term || p.keyword || p.search_query || p.q || p.Query || p.searchTerm
  }
  if (!p.command) {
    const rawCmd = p.cmd || p.terminal_command || p.exec || p.command_line || p.CommandLine || p.parameters
    if (Array.isArray(rawCmd)) {
      p.command = rawCmd.filter((c: any) => typeof c === 'string' && c.trim()).join('; ')
    } else if (typeof rawCmd === 'string') {
      p.command = rawCmd
    }
  } else if (Array.isArray(p.command)) {
    p.command = p.command.filter((c: any) => typeof c === 'string' && c.trim()).join('; ')
  }
  if (!p.question) {
    p.question = p.question || p.query || p.prompt || p.message || p.text || p.explanation || p.reason || ''
  }

  // 4. Line slice integers
  if (p.startLine === undefined && p.start_line !== undefined) p.startLine = Number(p.start_line)
  if (p.endLine === undefined && p.end_line !== undefined) p.endLine = Number(p.end_line)

  // 5. Multi-replace chunks
  const rawChunks = p.replacements || p.replacement_chunks || p.chunks || p.ReplacementChunks || p.edits
  if (Array.isArray(rawChunks)) {
    p.replacements = rawChunks
      .map((chunk: any) => ({
        targetContent: String(chunk.targetContent || chunk.target || chunk.target_content || chunk.old_content || chunk.TargetContent || ''),
        replacementContent: String(chunk.replacementContent || chunk.replacement || chunk.replacement_content || chunk.new_content || chunk.ReplacementContent || ''),
      }))
      .filter((chunk: AgentToolReplacementChunk) => chunk.targetContent)
    p.chunks = p.replacements
  }

  return p
}

/**
 * Zero-dependency strict schema validator and parameter coercer for Agent tool payloads.
 */
export function validateAndSanitize(toolCall: AgentToolCall): SchemaValidationResult {
  const errors: string[] = []
  const rawParams = normalizeToolParams({ ...(toolCall.parameters || {}) })
  const tool = (normalizeToolName(toolCall.tool) || toolCall.tool) as SupportedToolName

  switch (tool) {
    case 'read_file': {
      if (!rawParams.filePath) {
        errors.push("Missing required parameter 'filePath' for read_file")
      } else {
        rawParams.filePath = String(rawParams.filePath)
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
      if (!rawParams.filePath) {
        errors.push("Missing required parameter 'filePath' for write_file")
      } else {
        rawParams.filePath = String(rawParams.filePath)
      }
      if (rawParams.content === undefined) {
        rawParams.content = ''
      } else {
        rawParams.content = String(rawParams.content)
      }
      break
    }

    case 'replace_file_content': {
      if (!rawParams.filePath) {
        errors.push("Missing required parameter 'filePath' for replace_file_content")
      } else {
        rawParams.filePath = String(rawParams.filePath)
      }
      if (rawParams.targetContent === undefined) {
        errors.push("Missing required parameter 'targetContent' for replace_file_content")
      } else {
        rawParams.targetContent = String(rawParams.targetContent)
      }
      if (rawParams.replacementContent === undefined) {
        errors.push("Missing required parameter 'replacementContent' for replace_file_content")
      } else {
        rawParams.replacementContent = String(rawParams.replacementContent)
      }
      break
    }

    case 'multi_replace_file_content': {
      if (!rawParams.filePath) {
        errors.push("Missing required parameter 'filePath' for multi_replace_file_content")
      } else {
        rawParams.filePath = String(rawParams.filePath)
      }
      if (!Array.isArray(rawParams.replacements) || rawParams.replacements.length === 0) {
        errors.push("Missing or non-array parameter 'replacements' for multi_replace_file_content")
      }
      break
    }

    case 'delete_file': {
      if (!rawParams.filePath) {
        errors.push("Missing required parameter 'filePath' for delete_file")
      } else {
        rawParams.filePath = String(rawParams.filePath)
      }
      break
    }

    case 'list_dir': {
      if (!rawParams.dirPath) {
        rawParams.dirPath = '.'
      } else {
        rawParams.dirPath = String(rawParams.dirPath)
      }
      break
    }

    case 'list_files_recursive': {
      if (!rawParams.dirPath) {
        rawParams.dirPath = '.'
      } else {
        rawParams.dirPath = String(rawParams.dirPath)
      }
      if (rawParams.maxDepth !== undefined) {
        const parsed = Number(rawParams.maxDepth)
        rawParams.maxDepth = isNaN(parsed) ? 3 : Math.max(1, Math.min(6, Math.floor(parsed)))
      }
      break
    }

    case 'create_directory': {
      const targetDir = rawParams.dirPath || rawParams.filePath
      if (!targetDir) {
        errors.push("Missing required parameter 'dirPath' for create_directory")
      } else {
        rawParams.dirPath = String(targetDir)
      }
      break
    }

    case 'copy_file': {
      const src = rawParams.sourcePath || rawParams.filePath
      const dst = rawParams.targetPath || rawParams.destination
      if (!src) {
        errors.push("Missing required parameter 'sourcePath' for copy_file")
      } else {
        rawParams.sourcePath = String(src)
      }
      if (!dst) {
        errors.push("Missing required parameter 'targetPath' for copy_file")
      } else {
        rawParams.targetPath = String(dst)
      }
      break
    }

    case 'move_file': {
      const src = rawParams.sourcePath || rawParams.filePath
      const dst = rawParams.targetPath || rawParams.destination
      if (!src) {
        errors.push("Missing required parameter 'sourcePath' for move_file")
      } else {
        rawParams.sourcePath = String(src)
      }
      if (!dst) {
        errors.push("Missing required parameter 'targetPath' for move_file")
      } else {
        rawParams.targetPath = String(dst)
      }
      break
    }

    case 'grep_search': {
      if (!rawParams.query) {
        errors.push("Missing required parameter 'query' for grep_search")
      } else {
        rawParams.query = String(rawParams.query)
      }
      if (rawParams.dirPath) {
        rawParams.dirPath = String(rawParams.dirPath)
      }
      break
    }

    case 'run_command': {
      if (!rawParams.command) {
        errors.push("Missing required parameter 'command' for run_command")
      } else {
        rawParams.command = String(rawParams.command)
      }
      if (rawParams.timeoutMs !== undefined) {
        const parsed = Number(rawParams.timeoutMs)
        rawParams.timeoutMs = isNaN(parsed) ? 60000 : Math.max(1000, parsed)
      }
      break
    }

    case 'extract_code_symbols': {
      if (!rawParams.filePath) {
        errors.push("Missing required parameter 'filePath' for extract_code_symbols")
      } else {
        rawParams.filePath = String(rawParams.filePath)
      }
      break
    }

    case 'web_search': {
      if (!rawParams.query) {
        errors.push("Missing required parameter 'query' for web_search")
      } else {
        rawParams.query = String(rawParams.query)
      }
      break
    }

    case 'fetch_web_content': {
      if (!rawParams.url) {
        errors.push("Missing required parameter 'url' for fetch_web_content")
      } else {
        rawParams.url = String(rawParams.url)
      }
      break
    }

    case 'download_file': {
      if (!rawParams.url || !rawParams.filePath) {
        errors.push("Missing required parameter 'url' or 'filePath' for download_file")
      } else {
        rawParams.url = String(rawParams.url)
        rawParams.filePath = String(rawParams.filePath)
      }
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

    case 'get_file_info': {
      if (!rawParams.filePath) {
        errors.push("Missing required parameter 'filePath' for get_file_info")
      } else {
        rawParams.filePath = String(rawParams.filePath)
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
      break
    }

    case 'ask': {
      if (!rawParams.question) {
        errors.push("Missing required parameter 'question' for ask")
      } else {
        rawParams.question = String(rawParams.question)
      }
      break
    }

    case 'git_status':
    case 'git_diff':
    case 'rollback_workspace':
    case 'rollback_last_step':
    case 'run_tests':
    case 'finish':
      break

    default:
      // A name that is neither a supported tool nor one of the aliases above is an invention,
      // and used to fall through this branch as valid: the orchestrator then dispatched it,
      // the executor had no handler, and the turn was spent on a tool that does not exist. In
      // a live run of 2026-08-24 step 1 was `npm_install` — plausible, and not a tool.
      // The catalogue is the same list native tool-calling models are given, so accepting a
      // name absent from it would mean accepting something no model was ever offered.
      if (!findToolSchema(tool)) {
        errors.push(
          `Unknown tool "${toolCall.tool}". It is not one of the tools this agent provides. To run a shell command, use "run_command" with a "command" parameter.`
        )
        break
      }
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
      tool,
      parameters: rawParams,
      explanation: toolCall.explanation,
    },
  }
}
