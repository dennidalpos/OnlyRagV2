import { createFixtureDirectory, retainFixture } from '../scripts/test/fixtureRuntime.mjs'
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'

import { logger } from './core/infrastructure/logging/logger'
import { CodingAgentLogger } from './core/infrastructure/logging/codingAgentLogger'
import { userDataRoot } from './core/infrastructure/filesystem/userDataRoot'
import { redactSecrets, sanitizeLogMessage } from './logRedactor'
import { checkOllamaStatus } from './diagnostics'

describe('SystemDiagnosticsLogger Tests', () => {
  it('keeps default operational and audit logs in the owned user-data profile', () => {
    expect(logger.getLogFilePath()).toBe(path.join(userDataRoot(), 'logs', 'app.log'))
    expect(new CodingAgentLogger().getLogFilePath()).toBe(path.join(userDataRoot(), 'logs', 'coding_agent_audit.log'))
    expect(userDataRoot()).not.toBe(process.cwd())
  })

  it('preserves an unrelated working-directory log when clearing the active profile', () => {
    const otherRoot = createFixtureDirectory('onlyrag-other-log-')
    const otherLog = path.join(otherRoot, 'logs', 'app.log')
    fs.mkdirSync(path.dirname(otherLog))
    fs.writeFileSync(otherLog, 'retained diagnostic history')
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(otherRoot)
    try {
      logger.clearLogs()
      expect(fs.readFileSync(otherLog, 'utf8')).toBe('retained diagnostic history')
      expect(fs.readFileSync(logger.getLogFilePath(), 'utf8')).toBe('')
    } finally {
      cwd.mockRestore()
      retainFixture(otherRoot)
    }
  })

  it('should write logs and clear both in-memory buffer and physical file on disk', () => {
    logger.log('INFO', 'TestCategory', 'Test log message for physical file clear verification')
    const logs = logger.getLogs()
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.some((l) => l.message.includes('Test log message'))).toBe(true)

    const logPath = logger.getLogFilePath()
    expect(fs.existsSync(logPath)).toBe(true)

    // Call clearLogs
    logger.clearLogs()

    // Buffer should be empty
    expect(logger.getLogs()).toHaveLength(0)

    // Physical file on disk should be empty (0 bytes or blank string)
    const diskContent = fs.readFileSync(logPath, 'utf-8')
    expect(diskContent).toBe('')
  })

  it('should redact URLs, local paths, and exception details from operational logs', () => {
    const message = 'Failed reading C:\\Users\\Utente\\workspace\\secret.txt from https://example.test/private: Error: token=secret'

    expect(sanitizeLogMessage(message)).toBe('Failed reading [path] from [url]: Error: [details redacted]')

    logger.log('ERROR', 'TestCategory', message)
    const inMemory = logger.getLogs().at(-1)?.message ?? ''
    const onDisk = fs.readFileSync(logger.getLogFilePath(), 'utf-8')

    expect(inMemory).not.toContain('C:\\Users\\Utente')
    expect(inMemory).not.toContain('https://example.test')
    expect(inMemory).not.toContain('token=secret')
    expect(onDisk).toContain('[details redacted]')
    expect(onDisk).not.toContain('token=secret')
  })

  it('redacts credentials without removing useful diagnostic endpoints and paths', () => {
    const message = 'Run at C:\\workspace via http://user:pass@127.0.0.1:11434?token=secret-value'

    const redacted = redactSecrets(message)

    expect(redacted).toContain('C:\\workspace')
    expect(redacted).toContain('http://[redacted]@127.0.0.1:11434?token=[redacted]')
    expect(redacted).not.toContain('pass')
    expect(redacted).not.toContain('secret-value')
  })

  it('keeps file logging alive when a detached console pipe is closed', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementationOnce(() => {
      throw new Error('EPIPE')
    })

    expect(() => logger.log('WARN', 'TestCategory', 'Detached console pipe')).not.toThrow()
    expect(fs.readFileSync(logger.getLogFilePath(), 'utf-8')).toContain('Detached console pipe')
    consoleSpy.mockRestore()
  })
})

it('lists only native Ollama tags and reports when that inventory is unavailable', async () => {
  const paths: string[] = []
  const model = 'hf.co/owner/repo:q4_k_m'
  let tagsAvailable = true
  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    if (request.url === '/api/tags') {
      response.writeHead(tagsAvailable ? 200 : 404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ models: [{ name: model, details: { format: 'gguf' } }, { model }] }))
      return
    }
    response.end(JSON.stringify({ data: [{ id: 'owner/repo:q4_k_m' }, { id: 'llamacpp:hash' }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
    const host = `http://127.0.0.1:${address.port}`
    expect(await checkOllamaStatus(host)).toMatchObject({
      status: 'online', models: [model], modelsCount: 1, modelDetails: { [model]: { format: 'gguf' } },
    })
    tagsAvailable = false
    expect(await checkOllamaStatus(host)).toMatchObject({ status: 'offline', models: [], modelsCount: 0 })
    expect(paths).toEqual(['/api/tags', '/api/tags'])
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
