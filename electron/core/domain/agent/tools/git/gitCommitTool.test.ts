import { describe, expect, it, vi } from 'vitest'
import { executeGitDiff, executeGitStatus, performGitCommit } from './gitCommitTool'

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

describe('git inspection tools', () => {
  it('formats a clean status through the injected git runner', () => {
    const run = vi.fn(() => '')
    expect(executeGitStatus('workspace', run)).toMatchObject({
      outputForHistory: expect.stringContaining('Working tree clean'),
    })
    expect(run).toHaveBeenCalledWith('workspace', 'status --short', 10000)
  })

  it('blocks a diff outside the validated workspace path', () => {
    const run = vi.fn()
    const result = executeGitDiff('workspace', '../secret.txt', false, { error: 'outside workspace' }, run)
    expect(result.outputForHistory).toContain('Security Violation: outside workspace')
    expect(run).not.toHaveBeenCalled()
  })

  it('formats a staged file diff through the injected git runner', () => {
    const run = vi.fn(() => 'diff --git a/app.ts b/app.ts')
    const result = executeGitDiff('workspace', 'app.ts', true, { safePath: 'workspace/app.ts' }, run)
    expect(result.outputForHistory).toContain('[GIT DIFF (staged): app.ts]')
    expect(run).toHaveBeenCalledWith('workspace', 'diff --staged -- "workspace/app.ts"', 15000)
  })
})
