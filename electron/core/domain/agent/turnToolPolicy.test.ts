import { describe, expect, it } from 'vitest'
import { resolveTurnToolPolicy, resolveVersionConflictTurnPolicy } from './turnToolPolicy'

describe('Coding Agent tool policy', () => {
  it('lets a coding run select exploration, editing, network and verification tools while Main still gates execution', () => {
    const policy = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'unknown', userTask: 'Build an app', agentMode: 'auto' })
    expect(policy.allowedTools).toEqual(expect.arrayContaining(['read_file', 'write_file', 'run_command', 'web_search', 'run_tests', 'finish']))
    expect(policy.allowedTools).not.toContain('git_commit')
  })

  it('exposes commit only when the user explicitly asks for it', () => {
    const policy = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'unknown', userTask: 'Commit this work', agentMode: 'auto' })
    expect(policy.allowedTools).toContain('git_commit')
  })

  it('advertises only read tools in Ask mode', () => {
    const policy = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'unknown', userTask: 'Explain the app', agentMode: 'ask' })
    expect(policy.allowedTools).toContain('read_file')
    expect(policy.allowedTools).not.toContain('write_file')
    expect(policy.allowedTools).not.toContain('run_command')
  })

  it('allows only finish after verified closure', () => {
    const policy = resolveTurnToolPolicy({ directiveKind: 'session_closure', editTargetState: 'unknown', userTask: 'Finish' })
    expect(policy.allowedTools).toEqual(['finish'])
  })

  it('requires a fresh read after a version conflict', () => {
    expect(resolveVersionConflictTurnPolicy('src/App.tsx')).toEqual({
      allowedTools: ['read_file'],
      rationale: 'the stale edit must be refreshed from src/App.tsx',
      requiredReadPath: 'src/App.tsx',
    })
  })
})
