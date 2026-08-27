import { describe, expect, it } from 'vitest'
import { authorizeOfflineStrict, offlineStrictPolicyGateway, shellCommandHasEgress } from './offlineStrictPolicy'

function request(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-42',
    toolName: 'read_file',
    capability: 'filesystem',
    operation: 'read',
    mode: 'offline-strict',
    workspaceRoot: 'D:/projects/demo',
    consent: { requested: false, granted: false },
    ...overrides,
  } as any
}

describe('offline-strict capability policy', () => {
  it('allows local filesystem and Git inspection', () => {
    expect(authorizeOfflineStrict(request()).allowed).toBe(true)
    expect(authorizeOfflineStrict(request({ capability: 'git', operation: 'read', toolName: 'git_status' })).allowed).toBe(true)
  })

  it('blocks HTTP/download and browser capabilities', () => {
    expect(authorizeOfflineStrict(request({ capability: 'http-download', operation: 'connect', toolName: 'web_search', target: 'https://example.test' }))).toMatchObject({
      allowed: false,
      reason: 'Network egress is disabled in offline-strict mode',
    })
    expect(authorizeOfflineStrict(request({ capability: 'browser', operation: 'open', toolName: 'open_in_browser' })).allowed).toBe(false)
  })

  it('blocks network-capable shell commands but allows local commands', () => {
    expect(shellCommandHasEgress('Invoke-WebRequest https://example.test')).toBe(true)
    expect(shellCommandHasEgress('npm run typecheck')).toBe(false)
    expect(authorizeOfflineStrict(request({ capability: 'shell', operation: 'execute', toolName: 'run_command', target: 'git pull origin main' })).allowed).toBe(false)
    expect(authorizeOfflineStrict(request({ capability: 'shell', operation: 'execute', toolName: 'run_command', target: 'npm run test' })).allowed).toBe(true)
  })

  it('blocks Git network operations and rejects unimplemented policy modes', () => {
    expect(authorizeOfflineStrict(request({ capability: 'git', operation: 'connect', toolName: 'git_remote' })).allowed).toBe(false)
    expect(authorizeOfflineStrict(request({ mode: 'local-only' })).allowed).toBe(false)
    expect(offlineStrictPolicyGateway.authorize(request({ capability: 'filesystem', operation: 'write', toolName: 'write_file' })).auditId).toContain('policy-session-42')
  })
})
