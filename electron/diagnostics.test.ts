import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { logger } from './core/infrastructure/logging/logger'
import { redactSecrets, sanitizeLogMessage } from './logRedactor'

describe('SystemDiagnosticsLogger Tests', () => {
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
