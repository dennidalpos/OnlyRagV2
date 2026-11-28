import { describe, expect, it } from 'vitest'
import { createServer, get } from 'node:http'
import { once } from 'node:events'
import { isLocalOllamaHost } from '../../../../shared/domain/ollamaHost'
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
  it.each([
    ['http://localhost:11434/api/tags', true],
    ['http://LOCALHOST:8080/a?b=c', true],
    ['http://127.0.0.1:8080/health', true],
    ['http://[::1]:11434/api/tags', true],
    ['https://[0:0:0:0:0:0:0:1]:443/path', true],
    ['http://[::ffff:127.0.0.1]:8080/', false],
    ['http://[::ffff:7f00:1]/', false],
    ['http://[::2]/', false],
    ['http://[fd00::1]/', false],
    ['http://192.168.1.2/', false],
    ['https://localhost.example.test/', false],
    ['http://localhost@external.test/', false],
    ['https://example.test/', false],
    ['http://[::1', false],
  ])('classifies %s consistently with Ollama (%s)', (url, allowed) => {
    expect(isLoopbackTarget(url)).toBe(allowed)
    expect(isLocalOllamaHost(url)).toBe(allowed)
    for (const capability of ['browser', 'http-download'] as const) {
      expect(authorizeLocalOnly({ ...base, capability, target: url }).allowed).toBe(allowed)
    }
  })

  it('authorizes and reaches an owned IPv6 loopback server', async () => {
    const server = createServer((_request, response) => response.end('owned-loopback'))
    try {
      server.listen(0, '::1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing owned server port')
      const target = `http://[::1]:${address.port}/health`
      expect(isLocalOllamaHost(target)).toBe(true)
      expect(authorizeLocalOnly({ ...base, target }).allowed).toBe(true)
      const body = await new Promise<string>((resolve, reject) => {
        get(target, (response) => {
          expect(response.statusCode).toBe(200)
          let content = ''
          response.on('data', (chunk) => {
            content += chunk
          })
          response.on('end', () => resolve(content))
          response.on('error', reject)
        }).on('error', reject)
      })
      expect(body).toBe('owned-loopback')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

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
    expect(
      authorizeLocalOnly({ ...base, capability: 'git', operation: 'connect', toolName: 'git_fetch', target: 'https://github.com/example/repo' }).allowed,
    ).toBe(false)
    expect(
      authorizeLocalOnly({ ...base, capability: 'shell', operation: 'execute', toolName: 'run_command', target: 'curl https://example.test' }).allowed,
    ).toBe(false)
    expect(authorizeLocalOnly({ ...base, capability: 'filesystem', operation: 'read', toolName: 'read_file' }).allowed).toBe(true)
  })
})
