import type { AppSettings } from '../../../../src/types'

export type AgentMode = 'plan' | 'ask' | 'agent'

export interface AgentTaskPayload {
  userTask: string
  agentMode: AgentMode
  workspacePath?: string | null
  isStandaloneMode?: boolean
  activeModel?: string
  pinnedFiles?: { name: string; path: string; content: string }[]
  attachedDocs?: { id: string; filename: string; extractedMarkdown: string }[]
  activeFile?: { name: string; path: string; content: string } | null
  settings?: AppSettings
}

export interface AgentLogEntry {
  id: string
  timestamp: string
  type: 'info' | 'tool_call' | 'terminal' | 'approval_request'
  message: string
  detail?: string
}

export interface AgentApprovalRequest {
  id: string
  toolName: string
  description: string
  params: Record<string, any>
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
  | 'delete_file'
  | 'grep_search'
  | 'list_dir'
  | 'web_search'
  | 'fetch_web_content'
  | 'download_file'
  | 'run_command'
  | 'inspect_os_env'
  | 'ask'
  | 'finish'

export interface AgentToolCall {
  tool: SupportedToolName
  parameters: {
    filePath?: string
    dirPath?: string
    targetContent?: string
    replacementContent?: string
    replacements?: AgentToolReplacementChunk[]
    content?: string
    command?: string
    query?: string
    url?: string
    targetPath?: string
    question?: string
    isRegex?: boolean
    caseInsensitive?: boolean
    startLine?: number
    endLine?: number
    maxResults?: number
    summary?: string
    [key: string]: any
  }
  explanation?: string
}
