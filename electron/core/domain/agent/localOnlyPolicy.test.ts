import { describe, expect, it } from 'vitest'
import { authorizeLocalOnly, isLoopbackTarget } from './localOnlyPolicy'

const base = {
  sessionId: 'session-local',
  toolName: 'fetch_web_content',
  capability: 'http-download' as const,
  operation: 'connect' as const,
  mode: 'local-only' as const,
  workspaceRoot: 'D:/projects/demo',
  consent: { requested: false, granted: false },
}

describe('local-only capability policy', () => {
  it('recognizes only loopback URL targets', () => {
    expect(isLoopbackTarget('http://localhost:11434/api')).toBe(true)
    expect(isLoopbackTarget('http://127.0.0.1:8080/health')).toBe(true)
    expect(isLoopbackTarget('https://example.test')).toBe(false)
  })

  it('allows loopback HTTP and blocks external HTTP', () => {
    expect(authorizeLocalOnly({ ...base, target: 'http://127.0.0.1:11434/api' }).allowed).toBe(true)
    expect(authorizeLocalOnly({ ...base, target: 'https://example.test' })).toMatchObject({
      allowed: false,
      reason: 'Only loopback network targets are allowed in local-only mode',
    })
  })

  it('blocks remote Git and external shell egress while allowing local filesystem', () => {
    expect(authorizeLocalOnly({ ...base, capability: 'git', operation: 'connect', toolName: 'git_fetch', target: 'https://github.com/example/repo' }).allowed).toBe(false)
    expect(authorizeLocalOnly({ ...base, capability: 'shell', operation: 'execute', toolName: 'run_command', target: 'curl https://example.test' }).allowed).toBe(false)
    expect(authorizeLocalOnly({ ...base, capability: 'filesystem', operation: 'read', toolName: 'read_file' }).allowed).toBe(true)
  })
})
