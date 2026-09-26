import { z } from 'zod'
import type { AgentToolCall } from '../agentTypes'
import type { PendingMutationType } from '../../../../../shared/domain/agent/pendingChangeProjection'
import { AGENT_MAIN_TEXT_IT, formatAgentTextIt, type AgentMainTextKey } from '../../../../../shared/domain/agent/agentMainText'

const nonBlank = z.string().trim().min(1).max(4096)
const toolLogMessageSchema = z
  .object({
    key: z.enum(Object.keys(AGENT_MAIN_TEXT_IT) as [AgentMainTextKey, ...AgentMainTextKey[]]),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .strict()

type ToolLogMessage = { key: AgentMainTextKey; params?: Readonly<Record<string, string | number>> }

export const toolExecutionResultSchema = z
  .object({
    outcome: z.enum(['success', 'failure', 'rejected', 'blocked']),
    outputForHistory: z.string(),
    logMessage: z.string(),
    logDetail: z.string().optional(),
    localized: z.object({ message: toolLogMessageSchema }).strict().optional(),
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
  localized?: { message: ToolLogMessage }
  isTerminal?: boolean
  terminalCode?: 'MODEL_UNSUITABLE'
  changeStats?: { filePath: string; additions: number; deletions: number }
  verification?: { ran: true; passed: boolean }
  noOpMutation?: boolean
  /** Whether an externally visible effect is known after execution returns. */
  effectOutcome?: 'none' | 'confirmed' | 'uncertain'
}

export type ClassifiedToolExecutionResult = ToolExecutionResult

/** A tool result's log line: the Italian fallback text plus the key the UI renders in the user's language. */
export function toolLog(key: AgentMainTextKey, params?: Readonly<Record<string, string | number>>): Pick<ToolExecutionResult, 'logMessage' | 'localized'> {
  const message = params ? { key, params } : { key }
  return { logMessage: formatAgentTextIt(message), localized: { message } }
}

/** Maps file-mutating tools to the mutation shape shown by the approval surface. */
export const FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE: Partial<Record<AgentToolCall['tool'], PendingMutationType>> = {
  write_file: 'write_file',
  replace_file_content: 'replace_chunk',
  multi_replace_file_content: 'multi_replace',
  delete_file: 'delete_file',
}
