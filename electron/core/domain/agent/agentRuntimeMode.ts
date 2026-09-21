import type { SupportedToolName, AgentMode } from './agentTypes'

export type RuntimeFsmState = 'ASK' | 'GUIDED' | 'AUTO'

export interface ModePermissionConfig {
  readonly allowedTools: ReadonlySet<SupportedToolName>
  readonly allowsFileModifications: boolean
  readonly allowsTerminalExecution: boolean
  readonly description: string
}

export const MODE_PERMISSIONS: Record<RuntimeFsmState, ModePermissionConfig> = {
  ASK: {
    allowedTools: new Set<SupportedToolName>([
      'read_file',
      'get_file_info',
      'extract_code_symbols',
      'list_dir',
      'list_files_recursive',
      'grep_search',
      'git_status',
      'git_diff',
      'web_search',
      'fetch_web_content',
      'inspect_os_env',
      'open_in_browser',
      'validate_visual_artifact',
      'update_plan',
      'ask',
      'finish',
    ]),
    allowsFileModifications: false,
    allowsTerminalExecution: false,
    description: 'Strictly read-only exploration and Q&A.',
  },
  GUIDED: {
    allowedTools: new Set<SupportedToolName>([
      'read_file',
      'get_file_info',
      'extract_code_symbols',
      'replace_file_content',
      'multi_replace_file_content',
      'write_file',
      'create_directory',
      'copy_file',
      'move_file',
      'delete_file',
      'grep_search',
      'list_dir',
      'list_files_recursive',
      'web_search',
      'fetch_web_content',
      'download_file',
      'run_command',
      'run_tests',
      'inspect_os_env',
      'git_diff',
      'git_status',
      'git_commit',
      'rollback_workspace',
      'rollback_last_step',
      'ensure_tool',
      'update_plan',
      'ask',
      'open_in_browser',
      'validate_visual_artifact',
      'finish',
    ]),
    allowsFileModifications: true,
    allowsTerminalExecution: true,
    description: 'Review-first execution. Mutating tools require explicit approval.',
  },
  AUTO: {
    allowedTools: new Set<SupportedToolName>([
      'read_file',
      'get_file_info',
      'extract_code_symbols',
      'replace_file_content',
      'multi_replace_file_content',
      'write_file',
      'create_directory',
      'copy_file',
      'move_file',
      'delete_file',
      'grep_search',
      'list_dir',
      'list_files_recursive',
      'web_search',
      'fetch_web_content',
      'download_file',
      'run_command',
      'run_tests',
      'inspect_os_env',
      'git_diff',
      'git_status',
      'git_commit',
      'rollback_workspace',
      'rollback_last_step',
      'ensure_tool',
      'update_plan',
      'ask',
      'open_in_browser',
      'validate_visual_artifact',
      'finish',
    ]),
    allowsFileModifications: true,
    allowsTerminalExecution: true,
    description: 'Trusted local autonomous execution. git_commit remains explicitly gated.',
  },
}

export class AgentRuntimeModeFsm {
  private currentMode: RuntimeFsmState

  constructor(initialMode: AgentMode = 'guided') {
    this.currentMode = this.normalizeMode(initialMode)
  }

  public getMode(): RuntimeFsmState {
    return this.currentMode
  }

  public isToolAllowed(toolName: string): boolean {
    const config = MODE_PERMISSIONS[this.currentMode]
    return config.allowedTools.has(toolName as SupportedToolName)
  }

  public filterAllowedTools(tools: (SupportedToolName | string)[]): SupportedToolName[] {
    const config = MODE_PERMISSIONS[this.currentMode]
    return tools.filter((t): t is SupportedToolName => config.allowedTools.has(t as SupportedToolName))
  }

  private normalizeMode(mode: string): RuntimeFsmState {
    const upper = (mode || 'GUIDED').toUpperCase()
    if (upper === 'ASK' || upper === 'GUIDED' || upper === 'AUTO') {
      return upper as RuntimeFsmState
    }
    return 'GUIDED'
  }
}
