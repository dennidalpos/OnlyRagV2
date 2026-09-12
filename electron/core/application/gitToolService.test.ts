import { describe, expect, it, vi } from 'vitest'
import { GitToolService } from './gitToolService'

describe('GitToolService', () => {
  const dependencies = (overrides: Partial<ConstructorParameters<typeof GitToolService>[0]> = {}) => ({
    run: vi.fn(() => ''),
    previewCommit: vi.fn(() => ({ paths: ['app.ts'], diffText: 'diff', diffHash: 'hash' })),
    commit: vi.fn(() => 'created'),
    markCommitBoundary: vi.fn(),
    ...overrides,
  })

  it('delegates status through the injected runner', () => {
    const run = vi.fn(() => ' M src/App.tsx\n')
    const service = new GitToolService(dependencies({ run }))

    const result = service.executeStatus('C:\\workspace')

    expect(run).toHaveBeenCalledWith('C:\\workspace', 'status --short', 10000)
    expect(result.outputForHistory).toContain('M src/App.tsx')
  })

  it('rejects an empty commit message before invoking infrastructure', () => {
    const commit = vi.fn(() => 'created')
    const service = new GitToolService(dependencies({ commit }))

    const result = service.executeCommit({ commitMessage: '   ' }, 'C:\\workspace')

    expect(result.outputForHistory).toContain('commitMessage parameter is required')
    expect(commit).not.toHaveBeenCalled()
  })
})
