import { describe, expect, it, vi } from 'vitest'
import { executeMultiReplaceFileContentTool } from './multiReplaceFileContentTool'

describe('executeMultiReplaceFileContentTool', () => {
  it('records a journal snapshot and reports the updated chunk count', async () => {
    const journal = { recordBeforeModification: vi.fn() }
    const repository = {
      readIfExists: vi.fn().mockReturnValue('one\ntwo'),
      writeFileVersioned: vi.fn((_path, _content, _hash, beforeWrite) => {
        beforeWrite()
        return { success: true }
      }),
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
      (content) => `hash:${content}`,
    )

    expect(journal.recordBeforeModification).toHaveBeenCalledOnce()
    expect(repository.writeFileVersioned).toHaveBeenCalledWith(expect.any(String), 'ONE\ntwo', 'hash:one\ntwo', expect.any(Function))
    expect(result.outputForHistory).toContain('Successfully replaced 1 chunks')
  })

  it('rejects empty replacement batches', async () => {
    const result = await executeMultiReplaceFileContentTool(
      { filePath: 'src/file.ts', replacements: [] },
      'C:/workspace',
      '',
      () => null,
      () => '',
      { readIfExists: () => '', writeFileVersioned: vi.fn() },
      { recordBeforeModification: vi.fn() },
      () => ({ filePath: 'src/file.ts', additions: 0, deletions: 0 }),
      (content) => `hash:${content}`,
    )

    expect(result.logMessage).toBe('Missing multi-replace parameters')
  })

  it('rejects an ambiguous batch before journaling or writing partial content', async () => {
    const journal = { recordBeforeModification: vi.fn() }
    const repository = { readIfExists: () => 'same\nsame\ntail', writeFileVersioned: vi.fn() }

    const result = await executeMultiReplaceFileContentTool(
      { filePath: 'src/file.ts', replacements: [
        { targetContent: 'tail', replacementContent: 'TAIL' },
        { targetContent: 'same', replacementContent: 'SAME' },
      ] },
      'C:/workspace', '', () => null, () => '', repository, journal,
      () => ({ filePath: 'src/file.ts', additions: 0, deletions: 0 }),
      (content) => `hash:${content}`,
    )

    expect(result.outputForHistory).toContain('matched 2 locations')
    expect(result.outputForHistory).toContain('No content was written')
    expect(journal.recordBeforeModification).not.toHaveBeenCalled()
    expect(repository.writeFileVersioned).not.toHaveBeenCalled()
  })
})
