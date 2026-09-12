import { describe, expect, it } from 'vitest'
import { applyUniqueReplacements, compactMutationDiff, versionConflictFeedback } from './versionedFileMutation'

describe('versionedFileMutation', () => {
  it('applies exact unique replacements and preserves CRLF', () => {
    const result = applyUniqueReplacements('one\r\ntwo\r\n', [{ targetContent: 'two', replacementContent: 'TWO' }])
    expect(result).toEqual({ success: true, content: 'one\r\nTWO\r\n', replacedCount: 1 })
  })

  it('rejects missing and ambiguous expected text', () => {
    expect(applyUniqueReplacements('same same', [{ targetContent: 'same', replacementContent: 'x' }])).toMatchObject({ success: false })
    expect(applyUniqueReplacements('current', [{ targetContent: 'stale', replacementContent: 'x' }])).toMatchObject({ success: false })
  })

  it('formats a bounded current-to-proposed diff', () => {
    expect(compactMutationDiff('old\n', 'new\n')).toBe('- old\n+ new')
  })

  it('tells the agent to create an absent file without a fabricated version', () => {
    expect(versionConflictFeedback('tailwind.config.js', 'sha256:stale', 'missing')).toContain(
      'call write_file without expectedContentHash'
    )
    expect(versionConflictFeedback('tailwind.config.js', 'sha256:stale', 'missing')).not.toContain('Read the file again')
  })
})
