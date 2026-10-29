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

  it('inserts replacement text literally, without expanding $ patterns', () => {
    const replacement = "const a = '$&'; const b = \"$'\"; const c = `$$props` + '$`'"
    const result = applyUniqueReplacements('before\nTARGET\nafter\n', [{ targetContent: 'TARGET', replacementContent: replacement }])
    expect(result).toEqual({ success: true, content: `before\n${replacement}\nafter\n`, replacedCount: 1 })
  })

  it('formats a bounded current-to-proposed diff', () => {
    expect(compactMutationDiff('old\n', 'new\n')).toBe('- old\n+ new')
  })

  it('tells the agent to create an absent file without a fabricated version', () => {
    expect(versionConflictFeedback('tailwind.config.js', 'sha256:stale', 'missing')).toContain('call write_file again to create it')
    expect(versionConflictFeedback('tailwind.config.js', 'sha256:stale', 'missing')).not.toContain('Read the file again')
  })
})

describe('actionable replace failures', () => {
  it('points at the line that matches except for indentation', () => {
    const result = applyUniqueReplacements('function a() {\n\treturn 1\n}\n', [{ targetContent: '  return 1', replacementContent: '  return 2' }])
    expect(result).toMatchObject({ success: false })
    expect(result.success ? '' : result.error).toContain('line 2 with different indentation')
  })

  it('lists where an ambiguous target occurs', () => {
    const result = applyUniqueReplacements('x = 1\ny = 2\nx = 1\n', [{ targetContent: 'x = 1', replacementContent: 'x = 3' }])
    expect(result.success ? '' : result.error).toContain('lines 1, 3')
  })

  it('recognises line-number prefixes copied from a ranged read', () => {
    const result = applyUniqueReplacements('const a = 1\n', [{ targetContent: '12: const a = 1', replacementContent: 'const a = 2' }])
    expect(result.success ? '' : result.error).toContain('line-number prefix')
  })
})
