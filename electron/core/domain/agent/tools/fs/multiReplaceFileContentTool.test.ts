import { describe, expect, it, vi } from 'vitest'
import { executeMultiReplaceFileContentTool } from './multiReplaceFileContentTool'

describe('executeMultiReplaceFileContentTool', () => {
  it('records a journal snapshot and reports the updated chunk count', async () => {
    const journal = { recordBeforeModification: vi.fn() }
    const repository = {
      readIfExists: vi.fn()
        .mockReturnValueOnce('one\ntwo')
        .mockReturnValueOnce('ONE\ntwo'),
      multiReplaceChunks: vi.fn().mockResolvedValue({ success: true, replacedCount: 1 }),
    }

    const result = await executeMultiReplaceFileContentTool(
      { filePath: 'src/file.ts', replacements: [{ targetContent: 'one', replacementContent: 'ONE' }] },
      'C:/workspace',
      '',
      () => null,
      () => '',
      repository,
      journal,
      (filePath, before, after) => ({ filePath, additions: after.length - before.length, deletions: 0 }),
    )

    expect(journal.recordBeforeModification).toHaveBeenCalledOnce()
    expect(repository.multiReplaceChunks).toHaveBeenCalledOnce()
    expect(result.outputForHistory).toContain('Successfully replaced 1 chunks')
  })

  it('rejects empty replacement batches', async () => {
    const result = await executeMultiReplaceFileContentTool(
      { filePath: 'src/file.ts', replacements: [] },
      'C:/workspace',
      '',
      () => null,
      () => '',
      { readIfExists: () => '', multiReplaceChunks: vi.fn() },
      { recordBeforeModification: vi.fn() },
      () => ({ filePath: 'src/file.ts', additions: 0, deletions: 0 }),
    )

    expect(result.logMessage).toBe('Missing multi-replace parameters')
  })
})
