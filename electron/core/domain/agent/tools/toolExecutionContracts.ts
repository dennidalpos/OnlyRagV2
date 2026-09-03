import { z } from 'zod'
import type { AgentToolCall } from '../agentTypes'
import type { PendingMutationType } from '../../../../../shared/domain/agent/pendingChangeProjection'

const nonBlank = z.string().trim().min(1).max(4096)

export const toolContractEffectSchema = z.enum(['none', 'read', 'write', 'delete', 'execute', 'connect', 'download', 'commit', 'open'])
export const toolContractPreconditionSchema = z.object({
  kind: z.enum(['workspace', 'path-containment', 'parameter', 'consent', 'runtime', 'toolchain']),
  description: nonBlank.max(1000),
}).strict()
export const toolContractPolicySchema = z.object({
  capability: z.enum(['filesystem', 'shell', 'http-download', 'git', 'browser']).optional(),
  operation: z.enum(['read', 'write', 'delete', 'execute', 'connect', 'download', 'commit', 'open']).optional(),
  requiresConsent: z.boolean(),
}).strict()
export const toolContractEvidenceSchema = z.object({
  kind: z.enum(['output', 'change-stats', 'verification', 'audit', 'none']),
  description: nonBlank.max(1000),
}).strict()
export const toolContractRollbackSchema = z.object({
  supported: z.boolean(),
  kind: z.enum(['journal', 'adapter', 'none']),
  description: nonBlank.max(1000),
}).strict()

/** Serializable input shape shared by every tool contract. */
export const toolInputSchema = z.object({
  required: z.array(nonBlank.max(200)).max(50),
  properties: z.record(z.string().trim().min(1).max(200), z.object({
    type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
    description: nonBlank.max(1000).optional(),
  }).strict()).refine((properties) => Object.keys(properties).length <= 50),
}).strict()

/** One canonical declaration of a tool's boundary and lifecycle. */
export const toolContractSchema = z.object({
  toolName: nonBlank.max(200),
  schema: toolInputSchema,
  preconditions: z.array(toolContractPreconditionSchema).max(20),
  policy: toolContractPolicySchema,
  effect: toolContractEffectSchema,
  evidence: toolContractEvidenceSchema,
  rollback: toolContractRollbackSchema,
}).strict().superRefine((contract, context) => {
  if (contract.effect === 'none' && contract.rollback.supported) {
    context.addIssue({ code: 'custom', path: ['rollback', 'supported'], message: 'A no-effect tool cannot declare rollback support' })
  }
  if (contract.rollback.supported && contract.rollback.kind === 'none') {
    context.addIssue({ code: 'custom', path: ['rollback', 'kind'], message: 'Rollback support requires a rollback mechanism' })
  }
  if (contract.policy.requiresConsent && !contract.policy.capability) {
    context.addIssue({ code: 'custom', path: ['policy', 'capability'], message: 'Consent requires a policy capability' })
  }
})

export const toolExecutionResultSchema = z.object({
  outputForHistory: z.string(),
  logMessage: z.string(),
  logDetail: z.string().optional(),
  isTerminal: z.boolean().optional(),
  terminalCode: z.enum(['MODEL_UNSUITABLE']).optional(),
  changeStats: z.object({
    filePath: nonBlank,
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  }).strict().optional(),
  verification: z.object({ ran: z.literal(true), passed: z.boolean() }).strict().optional(),
  noOpMutation: z.boolean().optional(),
}).strict()

export interface ToolExecutionResult {
  outputForHistory: string
  logMessage: string
  logDetail?: string
  isTerminal?: boolean
  terminalCode?: 'MODEL_UNSUITABLE'
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
