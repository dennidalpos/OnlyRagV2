import { describe, expect, it } from 'vitest'
import { resolveTurnToolPolicy, resolveVersionConflictTurnPolicy } from './turnToolPolicy'

describe('resolveTurnToolPolicy', () => {
  it('adds the tools a correction directive orders to the edit tool', () => {
    const rename = resolveTurnToolPolicy({
      directiveKind: 'verification_failing',
      editTargetState: 'existing',
      userTask: 'Fix the app',
      requiredTools: ['move_file'],
    })
    expect(rename.allowedTools).toEqual(expect.arrayContaining(['move_file', 'write_file']))

    const plain = resolveTurnToolPolicy({ directiveKind: 'verification_failing', editTargetState: 'existing', userTask: 'Fix the app' })
    expect(plain.allowedTools).not.toContain('move_file')
  })

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

    const buildTask = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'missing', userTask: 'Create src/app.ts and run the build' })
    // A shell read would run as read_file anyway, so the direct call is not denied either.
    expect(buildTask.allowedTools).toEqual(expect.arrayContaining(['write_file', 'run_command', 'read_file']))

    const requested = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'unknown', userTask: 'Inspect the git diff' })
    expect(requested.allowedTools).toEqual(expect.arrayContaining(['git_status', 'git_diff']))
  })

  it('recognizes colloquial Italian build requests without turning inspections into edits', () => {
    const build = resolveTurnToolPolicy({
      directiveKind: 'focus',
      editTargetState: 'unknown',
      userTask: "Fammi un sito con un'immagine di un gatto che corre",
    })
    expect(build.allowedTools).toContain('write_file')
    expect(build.allowedTools).not.toContain('read_file')

    const inspection = resolveTurnToolPolicy({
      directiveKind: 'focus',
      editTargetState: 'unknown',
      userTask: 'Fammi vedere come funziona questo sito',
    })
    expect(inspection.allowedTools).toContain('read_file')
    expect(inspection.allowedTools).not.toContain('write_file')
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
