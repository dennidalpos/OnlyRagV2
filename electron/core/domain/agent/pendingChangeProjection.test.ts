import { describe, it, expect } from 'vitest'
import { projectPendingChange, isProposalApplicable } from '../../../../shared/domain/agent/pendingChangeProjection'
import { computeLineDiff, countDiffLines } from '../../../../shared/domain/agent/diffEngine'

describe('pendingChangeProjection', () => {
  it('should project write_file as the full replacement content', () => {
    const after = projectPendingChange({ type: 'write_file', content: 'new\nbody' }, 'old\nbody')
    expect(after).toBe('new\nbody')
  })

  it('should project delete_file as empty content, producing an all-deletions diff', () => {
    const before = 'a\nb\nc'
    const after = projectPendingChange({ type: 'delete_file' }, before)

    expect(after).toBe('')
    expect(countDiffLines(computeLineDiff(before, after))).toEqual({ additions: 0, deletions: 3 })
  })

  it('should substitute only the first occurrence for replace_chunk, matching the executor', () => {
    const before = 'value = 1\nvalue = 1\n'
    const after = projectPendingChange(
      { type: 'replace_chunk', targetContent: 'value = 1', replacementContent: 'value = 2' },
      before
    )

    expect(after).toBe('value = 2\nvalue = 1\n')
    expect(countDiffLines(computeLineDiff(before, after))).toEqual({ additions: 1, deletions: 1 })
  })

  it('should apply multi_replace chunks in order and skip chunks that no longer match', () => {
    const before = 'alpha\nbeta\ngamma'
    const after = projectPendingChange(
      {
        type: 'multi_replace',
        replacements: [
          { targetContent: 'alpha', replacementContent: 'ALPHA' },
          { targetContent: 'missing', replacementContent: 'ignored' },
          { targetContent: 'gamma', replacementContent: 'GAMMA' },
        ],
      },
      before
    )

    expect(after).toBe('ALPHA\nbeta\nGAMMA')
    expect(countDiffLines(computeLineDiff(before, after))).toEqual({ additions: 2, deletions: 2 })
  })

  it('should leave content untouched when the search target is absent', () => {
    const before = 'unchanged content'
    const proposal = { type: 'replace_chunk' as const, targetContent: 'nowhere', replacementContent: 'x' }

    expect(projectPendingChange(proposal, before)).toBe(before)
    expect(isProposalApplicable(proposal, before)).toBe(false)
  })

  it('should treat a write to a not-yet-existing file as a pure addition', () => {
    const after = projectPendingChange({ type: 'write_file', content: 'line1\nline2' }, '')
    expect(countDiffLines(computeLineDiff('', after))).toEqual({ additions: 2, deletions: 0 })
  })
})
