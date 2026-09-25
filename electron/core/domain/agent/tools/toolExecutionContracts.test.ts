import { describe, expect, it } from 'vitest'
import { FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE, toolExecutionResultSchema } from './toolExecutionContracts'

describe('tool execution contracts', () => {
  it('maps every file mutation tool to its approval projection type', () => {
    expect(FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE).toEqual({
      write_file: 'write_file',
      replace_file_content: 'replace_chunk',
      multi_replace_file_content: 'multi_replace',
      delete_file: 'delete_file',
    })
  })

  it('validates the common dispatcher result envelope', () => {
    expect(
      toolExecutionResultSchema.safeParse({
        outcome: 'success',
        outputForHistory: 'done',
        logMessage: 'Tool completed',
        isTerminal: true,
        verification: { ran: true, passed: true },
      }).success,
    ).toBe(true)
  })

  it('accepts the terminal MODEL_UNSUITABLE outcome', () => {
    expect(
      toolExecutionResultSchema.safeParse({
        outcome: 'blocked',
        outputForHistory: 'The requested tool capability is unavailable.',
        logMessage: 'Model capability unavailable',
        isTerminal: true,
        terminalCode: 'MODEL_UNSUITABLE',
      }).success,
    ).toBe(true)
  })
})
