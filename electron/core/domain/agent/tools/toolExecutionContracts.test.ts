import { describe, expect, it } from 'vitest'
import { FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE, toolContractSchema, toolExecutionResultSchema } from './toolExecutionContracts'

describe('tool execution contracts', () => {
  it('maps every file mutation tool to its approval projection type', () => {
    expect(FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE).toEqual({
      write_file: 'write_file',
      replace_file_content: 'replace_chunk',
      multi_replace_file_content: 'multi_replace',
      delete_file: 'delete_file',
    })
  })

  it('validates the canonical tool lifecycle contract', () => {
    const result = toolContractSchema.safeParse({
      toolName: 'delete_file',
      schema: {
        required: ['filePath'],
        properties: { filePath: { type: 'string', description: 'Workspace-relative target' } },
      },
      preconditions: [{ kind: 'path-containment', description: 'Target must remain inside the workspace' }],
      policy: { capability: 'filesystem', operation: 'delete', requiresConsent: false },
      effect: 'delete',
      evidence: { kind: 'change-stats', description: 'Reports the deleted target and line delta' },
      rollback: { supported: true, kind: 'journal', description: 'Restores the session snapshot' },
    })

    expect(result.success).toBe(true)
  })

  it('rejects lifecycle combinations that cannot be executed safely', () => {
    const result = toolContractSchema.safeParse({
      toolName: 'read_file',
      schema: { required: [], properties: {} },
      preconditions: [],
      policy: { requiresConsent: true },
      effect: 'none',
      evidence: { kind: 'none', description: 'No evidence' },
      rollback: { supported: true, kind: 'none', description: 'Nothing to restore' },
    })

    expect(result.success).toBe(false)
  })

  it('validates the common dispatcher result envelope', () => {
    expect(toolExecutionResultSchema.safeParse({
      outputForHistory: 'done',
      logMessage: 'Tool completed',
      isTerminal: true,
      verification: { ran: true, passed: true },
    }).success).toBe(true)
  })

  it('accepts the terminal MODEL_UNSUITABLE outcome', () => {
    expect(toolExecutionResultSchema.safeParse({
      outputForHistory: 'The requested tool capability is unavailable.',
      logMessage: 'Model capability unavailable',
      isTerminal: true,
      terminalCode: 'MODEL_UNSUITABLE',
    }).success).toBe(true)
  })
})
