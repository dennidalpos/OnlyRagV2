import { describe, expect, it } from 'vitest'
import { resolveTurnToolPolicy, resolveVersionConflictTurnPolicy } from './turnToolPolicy'

describe('resolveTurnToolPolicy', () => {
  it('exposes reads for exploration and one edit shape for known targets', () => {
    const exploration = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'unknown', userTask: 'Understand this module' })
    expect(exploration.allowedTools).toContain('read_file')
    expect(exploration.allowedTools).not.toContain('write_file')

    const edit = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'existing', userTask: 'Fix src/app.ts' })
    expect(edit.allowedTools).toContain('write_file')
    expect(edit.allowedTools).not.toContain('replace_file_content')
    expect(edit.allowedTools).not.toContain('read_file')
  })

  it('exposes commands only when selected or requested by the work', () => {
    const verification = resolveTurnToolPolicy({ directiveKind: 'verification_due', editTargetState: 'unknown', userTask: 'Fix the app' })
    expect(verification.allowedTools).toContain('run_command')

    const ordinary = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'missing', userTask: 'Create src/app.ts' })
    expect(ordinary.allowedTools).not.toContain('run_command')
    expect(ordinary.allowedTools).not.toContain('git_status')

    const requested = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'unknown', userTask: 'Inspect the git diff' })
    expect(requested.allowedTools).toEqual(expect.arrayContaining(['git_status', 'git_diff']))
  })

  it('allows only finish after verified closure', () => {
    const result = resolveTurnToolPolicy({ directiveKind: 'session_closure', editTargetState: 'unknown', userTask: 'Commit this work' })
    expect(result.allowedTools).toEqual(['finish'])
  })
})

describe('resolveVersionConflictTurnPolicy', () => {
  it('permits only a fresh read of the conflicted file', () => {
    expect(resolveVersionConflictTurnPolicy('src/App.tsx')).toEqual({
      allowedTools: ['read_file'],
      rationale: 'the stale edit must be refreshed from src/App.tsx',
      requiredReadPath: 'src/App.tsx',
    })
  })
})
