import { describe, expect, it, vi } from 'vitest'
import { GitToolService } from './gitToolService'

describe('GitToolService', () => {
  it('delegates status through the injected runner', () => {
    const run = vi.fn(() => ' M src/App.tsx\n')
    const service = new GitToolService({ run, commit: vi.fn() })

    const result = service.executeStatus('C:\\workspace')

    expect(run).toHaveBeenCalledWith('C:\\workspace', 'status --short', 10000)
    expect(result.outputForHistory).toContain('M src/App.tsx')
  })

  it('rejects an empty commit message before invoking infrastructure', () => {
    const commit = vi.fn(() => 'created')
    const service = new GitToolService({ run: vi.fn(() => ''), commit })

    const result = service.executeCommit({ commitMessage: '   ' }, 'C:\\workspace')

    expect(result.outputForHistory).toContain('commitMessage parameter is required')
    expect(commit).not.toHaveBeenCalled()
  })
})
