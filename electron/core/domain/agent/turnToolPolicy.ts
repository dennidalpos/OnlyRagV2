import type { SupportedToolName } from './agentTypes'
import type { PlanDirectiveKind } from './planDirectiveArbiter'

export type EditTargetState = 'existing' | 'missing' | 'unknown'

export interface TurnToolPolicyInput {
  directiveKind: PlanDirectiveKind
  editTargetState: EditTargetState
  userTask: string
  requiredTools?: readonly SupportedToolName[]
  agentMode?: 'ask' | 'guided' | 'auto'
}

export interface TurnToolPolicy {
  allowedTools: readonly SupportedToolName[]
  rationale: string
  requiredReadPath?: string
}

const READ_TOOLS: readonly SupportedToolName[] = [
  'read_file',
  'get_file_info',
  'extract_code_symbols',
  'list_dir',
  'list_files_recursive',
  'grep_search',
  'git_status',
  'git_diff',
  'inspect_os_env',
  'web_search',
  'fetch_web_content',
]

const WORK_TOOLS: readonly SupportedToolName[] = [
  ...READ_TOOLS,
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
  'create_directory',
  'copy_file',
  'move_file',
  'delete_file',
  'download_file',
  'run_command',
  'run_tests',
  'ensure_tool',
  'rollback_workspace',
  'rollback_last_step',
  'open_in_browser',
  'validate_visual_artifact',
  'update_plan',
]

/** The model chooses the next tool; Main still decides whether each concrete call may run. */
export function resolveTurnToolPolicy(input: TurnToolPolicyInput): TurnToolPolicy {
  if (input.directiveKind === 'session_closure') return { allowedTools: ['finish'], rationale: 'verified work is ready for a terminal report' }
  if (input.agentMode === 'ask') return { allowedTools: [...READ_TOOLS, 'ask', 'finish'], rationale: 'Ask mode is read-only' }

  const allowedTools: SupportedToolName[] = [...WORK_TOOLS, 'ask', 'finish']
  if (/\bcommit\b/i.test(input.userTask)) allowedTools.push('git_commit')
  return { allowedTools, rationale: 'the model may choose a relevant tool; every call remains subject to Main policy' }
}

export function resolveVersionConflictTurnPolicy(filePath: string): TurnToolPolicy {
  return {
    allowedTools: ['read_file'],
    rationale: `the stale edit must be refreshed from ${filePath}`,
    requiredReadPath: filePath,
  }
}
