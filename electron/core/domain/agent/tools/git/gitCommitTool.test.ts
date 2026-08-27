import { describe, expect, it, vi } from 'vitest'
import { performGitCommit } from './gitCommitTool'

describe('git commit tool', () => {
  it('rejects a blank commit message without executing git', () => {
    const commit = vi.fn()
    expect(performGitCommit('workspace', '  ', commit)).toMatchObject({ success: false })
    expect(commit).not.toHaveBeenCalled()
  })

  it('trims the message and formats a successful commit', () => {
    expect(performGitCommit('workspace', '  Add feature  ', () => 'created commit'))
      .toMatchObject({ success: true, output: expect.stringContaining('created commit') })
  })

  it('preserves git stdout and stderr when the command fails', () => {
    expect(performGitCommit('workspace', 'Add feature', () => {
      throw { stdout: { toString: () => 'nothing to commit' }, stderr: { toString: () => 'hook failed' } }
    })).toMatchObject({ success: false, output: 'Git Commit Error: nothing to commit\nhook failed' })
  })
})
