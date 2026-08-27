import type { AgentToolCall } from '../agentTypes'
import type { PendingMutationType } from '../pendingChangeProjection'

export interface ToolExecutionResult {
  outputForHistory: string
  logMessage: string
  logDetail?: string
  isTerminal?: boolean
  changeStats?: { filePath: string; additions: number; deletions: number }
  verification?: { ran: true; passed: boolean }
  noOpMutation?: boolean
}

/** Maps file-mutating tools to the mutation shape shown by the approval surface. */
export const FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE: Partial<Record<AgentToolCall['tool'], PendingMutationType>> = {
  write_file: 'write_file',
  replace_file_content: 'replace_chunk',
  multi_replace_file_content: 'multi_replace',
  delete_file: 'delete_file',
}
