import type { AppSettings } from '../../../../src/types'

export type AgentMode = 'plan' | 'ask' | 'agent'

export interface AgentTaskPayload {
  userTask: string
  initialUserTask?: string
  agentMode: AgentMode
  sessionId?: string
  workspacePath?: string | null
  isStandaloneMode?: boolean
  activeModel?: string
  pinnedFiles?: { name: string; path: string; content: string }[]
  attachedDocs?: { id: string; filename: string; extractedMarkdown: string }[]
  activeFile?: { name: string; path: string; content: string } | null
  settings?: AppSettings
}

export type AgentLogCategory =
  | 'user_prompt'
  | 'agent_thought'
  | 'tool_execution'
  | 'file_mutation'
  | 'command_execution'
  | 'test_run'
  | 'workspace_exploration'
  | 'web_research'
  | 'final_report'
  | 'agent_question'
  | 'system_alert'
  | 'generic_info'

export interface AgentLogEntry {
  id: string
  timestamp: string
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request'
  message: string
  detail?: string
  category?: AgentLogCategory
  toolName?: string
  target?: string
  status?: 'running' | 'success' | 'failure'
  modelName?: string
  verb?: 'Created' | 'Edited' | 'Deleted' | 'Moved' | 'Copied' | 'Ran' | 'Read' | 'Search' | 'Fetch' | 'Download' | 'Symbols' | 'List'
  testRun?: {
    isPass: boolean
    summary: string
    passedCount?: number
    failedCount?: number
  }
}

export interface AgentTaskResult {
  success: boolean
  summary: string
  error?: string
}

export interface AgentToolReplacementChunk {
  targetContent: string
  replacementContent: string
}

export type SupportedToolName =
  | 'read_file'
  | 'extract_code_symbols'
  | 'replace_file_content'
  | 'multi_replace_file_content'
  | 'write_file'
  | 'create_directory'
  | 'copy_file'
  | 'move_file'
  | 'delete_file'
  | 'grep_search'
  | 'list_dir'
  | 'list_files_recursive'
  | 'web_search'
  | 'fetch_web_content'
  | 'download_file'
  | 'run_command'
  | 'run_tests'
  | 'inspect_os_env'
  | 'git_diff'
  | 'git_status'
  | 'git_commit'
  | 'rollback_workspace'
  | 'rollback_last_step'
  | 'get_file_info'
  | 'ensure_tool'
  | 'update_plan'
  | 'ask'
  | 'open_in_browser'
  | 'validate_visual_artifact'
  | 'finish'

export interface AgentToolCall {
  tool: SupportedToolName
  parameters: {
    filePath?: string
    sourcePath?: string
    targetPath?: string
    dirPath?: string
    targetContent?: string
    replacementContent?: string
    replacements?: AgentToolReplacementChunk[]
    content?: string
    command?: string
    query?: string
    url?: string
    question?: string
    isRegex?: boolean
    caseInsensitive?: boolean
    startLine?: number
    endLine?: number
    maxDepth?: number
    maxResults?: number
    summary?: string
    staged?: boolean
    commitMessage?: string
    toolName?: string
    timeoutSeconds?: number
    milestoneId?: string
    status?: string
    notes?: string
    [key: string]: any
  }
  explanation?: string
}
