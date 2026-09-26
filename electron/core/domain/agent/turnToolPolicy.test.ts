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

describe('capability policy in the tool catalogue', () => {
  it('never offers a tool the policy refuses on every call', () => {
    const offline = resolveTurnToolPolicy({
      directiveKind: 'focus',
      editTargetState: 'unknown',
      userTask: 'Build',
      agentMode: 'auto',
      capabilityPolicyMode: 'offline-strict',
    })
    expect(offline.allowedTools).not.toEqual(expect.arrayContaining(['web_search']))
    for (const tool of ['web_search', 'fetch_web_content', 'download_file', 'ensure_tool', 'open_in_browser']) expect(offline.allowedTools).not.toContain(tool)
    expect(offline.allowedTools).toEqual(expect.arrayContaining(['read_file', 'write_file', 'run_command', 'run_tests', 'finish']))

    const local = resolveTurnToolPolicy({
      directiveKind: 'focus',
      editTargetState: 'unknown',
      userTask: 'Build',
      agentMode: 'auto',
      capabilityPolicyMode: 'local-only',
    })
    expect(local.allowedTools).not.toContain('web_search')
    expect(local.allowedTools).toContain('open_in_browser')

    const approved = resolveTurnToolPolicy({
      directiveKind: 'focus',
      editTargetState: 'unknown',
      userTask: 'Build',
      agentMode: 'auto',
      capabilityPolicyMode: 'network-approved',
    })
    expect(approved.allowedTools).toEqual(expect.arrayContaining(['web_search', 'fetch_web_content', 'open_in_browser']))
  })

  it('offers git_commit for an Italian commit request too', () => {
    const policy = resolveTurnToolPolicy({ directiveKind: 'focus', editTargetState: 'unknown', userTask: 'Correggi il bug e committa', agentMode: 'auto' })
    expect(policy.allowedTools).toContain('git_commit')
  })
})
