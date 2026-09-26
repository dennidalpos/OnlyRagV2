import { describe, expect, it, vi } from 'vitest'
import { executeMultiReplaceFileContentTool } from './multiReplaceFileContentTool'

describe('executeMultiReplaceFileContentTool', () => {
  it('records a journal snapshot and reports the updated chunk count', async () => {
    const journal = { recordOriginalState: vi.fn() }
    const repository = {
      readIfExists: vi.fn().mockReturnValue('one\ntwo'),
      writeFileVersioned: vi.fn((_path, _content, _hash, beforeWrite) => {
        beforeWrite('one\ntwo')
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
      async () => '\n[TYPECHECK] src/file.ts(1,1): error TS2304',
    )

    expect(journal.recordOriginalState).toHaveBeenCalledWith(expect.any(String), 'one\ntwo')
    expect(repository.writeFileVersioned).toHaveBeenCalledWith(expect.any(String), 'ONE\ntwo', 'hash:one\ntwo', expect.any(Function))
    expect(result.outputForHistory).toContain('Successfully replaced 1 chunks')
    // Like write_file, an edit reports what it changed and what the typechecker now says about the file.
    expect(result.outputForHistory).toContain('Applied change:\n- one\n+ ONE')
    expect(result.outputForHistory).toContain('[TYPECHECK] src/file.ts(1,1): error TS2304')
  })

  it('rejects empty replacement batches', async () => {
    const result = await executeMultiReplaceFileContentTool(
      { filePath: 'src/file.ts', replacements: [] },
      'C:/workspace',
      '',
      () => null,
      () => '',
      { readIfExists: () => '', writeFileVersioned: vi.fn() },
      { recordOriginalState: vi.fn() },
      () => ({ filePath: 'src/file.ts', additions: 0, deletions: 0 }),
      (content) => `hash:${content}`,
    )

    expect(result.localized?.message).toEqual({ key: 'toolEditMissingParams', params: { tool: 'multi_replace_file_content' } })
  })

  it('rejects an ambiguous batch before journaling or writing partial content', async () => {
    const journal = { recordOriginalState: vi.fn() }
    const repository = { readIfExists: () => 'same\nsame\ntail', writeFileVersioned: vi.fn() }

    const result = await executeMultiReplaceFileContentTool(
      {
        filePath: 'src/file.ts',
        replacements: [
          { targetContent: 'tail', replacementContent: 'TAIL' },
          { targetContent: 'same', replacementContent: 'SAME' },
        ],
      },
      'C:/workspace',
      '',
      () => null,
      () => '',
      repository,
      journal,
      () => ({ filePath: 'src/file.ts', additions: 0, deletions: 0 }),
      (content) => `hash:${content}`,
    )

    expect(result.outputForHistory).toContain('matched 2 locations')
    expect(result.outputForHistory).toContain('No content was written')
    expect(journal.recordOriginalState).not.toHaveBeenCalled()
    expect(repository.writeFileVersioned).not.toHaveBeenCalled()
  })

  it('rejects the invalid final AST before journaling or writing', async () => {
    const journal = { recordOriginalState: vi.fn() }
    const repository = { readIfExists: () => 'const value = 1', writeFileVersioned: vi.fn() }

    const result = await executeMultiReplaceFileContentTool(
      { filePath: 'src/file.ts', replacements: [{ targetContent: 'const value = 1', replacementContent: 'const value =' }] },
      'C:/workspace',
      '',
      () => null,
      () => '',
      repository,
      journal,
      () => ({ filePath: 'src/file.ts', additions: 0, deletions: 0 }),
      (content) => `hash:${content}`,
    )

    expect(result.outputForHistory).toContain('PRE-COMMIT AST VALIDATION ERROR')
    expect(journal.recordOriginalState).not.toHaveBeenCalled()
    expect(repository.writeFileVersioned).not.toHaveBeenCalled()
  })

  it('includes current and proposed content in a late-conflict diff', async () => {
    const repository = {
      readIfExists: () => 'const value = 1',
      writeFileVersioned: vi.fn().mockReturnValue({
        success: false,
        conflict: true,
        currentContentHash: 'new-hash',
        currentContent: 'const value = 3',
      }),
    }

    const result = await executeMultiReplaceFileContentTool(
      { filePath: 'src/file.ts', replacements: [{ targetContent: '1', replacementContent: '2' }] },
      'C:/workspace',
      '',
      () => null,
      () => '',
      repository,
      { recordOriginalState: vi.fn() },
      () => ({ filePath: 'src/file.ts', additions: 0, deletions: 0 }),
      (content) => (content === 'const value = 1' ? 'old-hash' : 'other-hash'),
    )

    expect(result.outputForHistory).toContain('Current vs proposed diff')
    expect(result.outputForHistory).toContain('- const value = 3')
    expect(result.outputForHistory).toContain('+ const value = 2')
  })
})
