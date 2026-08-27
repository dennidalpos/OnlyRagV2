import { describe, expect, it } from 'vitest'
import { FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE } from './toolExecutionContracts'

describe('tool execution contracts', () => {
  it('maps every file mutation tool to its approval projection type', () => {
    expect(FILE_MUTATION_TOOL_TO_PROPOSAL_TYPE).toEqual({
      write_file: 'write_file',
      replace_file_content: 'replace_chunk',
      multi_replace_file_content: 'multi_replace',
      delete_file: 'delete_file',
    })
  })
})
