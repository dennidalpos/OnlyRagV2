import { z } from 'zod'
import type { AgentToolCall } from '../agentTypes'
import type { PendingMutationType } from '../../../../../shared/domain/agent/pendingChangeProjection'

const nonBlank = z.string().trim().min(1).max(4096)

export const toolExecutionResultSchema = z
  .object({
    outcome: z.enum(['success', 'failure', 'rejected', 'blocked']),
    outputForHistory: z.string(),
    logMessage: z.string(),
    logDetail: z.string().optional(),
    isTerminal: z.boolean().optional(),
    terminalCode: z.enum(['MODEL_UNSUITABLE']).optional(),
    changeStats: z
      .object({
        filePath: nonBlank,
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    verification: z
      .object({ ran: z.literal(true), passed: z.boolean() })
      .strict()
      .optional(),
    noOpMutation: z.boolean().optional(),
    effectOutcome: z.enum(['none', 'confirmed', 'uncertain']).optional(),
  })
  .strict()

export interface ToolExecutionResult {
  outcome: 'success' | 'failure' | 'rejected' | 'blocked'
  outputForHistory: string
  logMessage: string
  logDetail?: string
  isTerminal?: boolean
  terminalCode?: 'MODEL_UNSUITABLE'
  changeStats?: { filePath: string; additions: number; deletions: number }
  verification?: { ran: true; passed: boolean }
  noOpMutation?: boolean
  /** Whether an externally visible effect is known after execution returns. */
  effectOutcome?: 'none' | 'confirmed' | 'uncertain'
}

export type ClassifiedToolExecutionResult = ToolExecutionResult

/** Maps file-mutating tools to the mutation shape shown by the approval surface. */
export const FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE: Partial<Record<AgentToolCall['tool'], PendingMutationType>> = {
  write_file: 'write_file',
  replace_file_content: 'replace_chunk',
  multi_replace_file_content: 'multi_replace',
  delete_file: 'delete_file',
}
