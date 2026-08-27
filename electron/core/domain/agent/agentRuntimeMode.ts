import type { SupportedToolName, AgentMode } from './agentTypes'

export type RuntimeFsmState = 'ASK' | 'PLAN' | 'AGENT'

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
    description: 'Read-only exploratory & Q&A mode. Mutating actions require explicit user approval.',
  },
  PLAN: {
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
    description: 'Architecture & task decomposition mode. Generates structured verification checklists.',
  },
  AGENT: {
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
    description: 'Autonomous execution mode with full read/write and sandboxed command execution. git_commit is always gated behind explicit user approval regardless of mode (see the Always-Confirm Gate in agentOrchestratorAppService.ts).',
  },
}

export class AgentRuntimeModeFsm {
  private currentMode: RuntimeFsmState

  constructor(initialMode: AgentMode = 'agent') {
    this.currentMode = this.normalizeMode(initialMode)
  }

  public getMode(): RuntimeFsmState {
    return this.currentMode
  }

  public isToolAllowed(toolName: SupportedToolName): boolean {
    const config = MODE_PERMISSIONS[this.currentMode]
    return config.allowedTools.has(toolName)
  }

  public filterAllowedTools(tools: SupportedToolName[]): SupportedToolName[] {
    const config = MODE_PERMISSIONS[this.currentMode]
    return tools.filter((t) => config.allowedTools.has(t))
  }

  private normalizeMode(mode: string): RuntimeFsmState {
    const upper = (mode || 'AGENT').toUpperCase()
    if (upper === 'ASK' || upper === 'PLAN' || upper === 'AGENT') {
      return upper as RuntimeFsmState
    }
    return 'AGENT'
  }
}
