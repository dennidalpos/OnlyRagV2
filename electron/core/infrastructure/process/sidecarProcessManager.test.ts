import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import http from 'node:http'

const profileRoot = vi.hoisted(() => `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/onlyrag-sidecar-state-${crypto.randomUUID()}`)

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn(() => profileRoot),
    isPackaged: false,
  },
}))

import { classifySidecarStderr, SidecarProcessManager } from './sidecarProcessManager'
import { logger } from '../logging/logger'

afterAll(() => fs.rmSync(profileRoot, { recursive: true, force: true }))

describe('Sidecar log privacy', () => {
  let logDir: string
  afterEach(() => {
    vi.restoreAllMocks()
    if (logDir) fs.rmSync(logDir, { recursive: true, force: true })
  })

  function isolatedManager() {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-sidecar-log-'))
    vi.spyOn(logger, 'getLogFilePath').mockReturnValue(path.join(logDir, 'app.log'))
    return new SidecarProcessManager() as unknown as {
      writeSidecarLog(level: 'INFO' | 'WARN', message: string): void
      attachSidecarProcessLogs(child: ChildProcess): void
    }
  }

  it('redacts before persistence and keeps rotated records safe', () => {
    const manager = isolatedManager()
    const message = 'INFO: token=dummy-secret C:\\private\\document.pdf https://example.test/private'
    manager.writeSidecarLog('INFO', message)
    const active = path.join(logDir, 'sidecar.log')
    fs.truncateSync(active, 11 * 1024 * 1024)
    manager.writeSidecarLog('WARN', message)
    for (const file of [active, path.join(logDir, 'sidecar.1.log')]) {
      const content = fs.readFileSync(file, 'utf8')
      expect(content).toContain('[redacted]')
      expect(content).toContain('[path]')
      expect(content).not.toContain('dummy-secret')
      expect(content).not.toContain('private')
    }
  })

  it('redacts split process lines and EOF tails before disk and diagnostics', async () => {
    const manager = isolatedManager()
    const diagnostics = vi.spyOn(logger, 'log').mockImplementation((level, category, message) => ({ level, category, message, timestamp: '' }))
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdout, stderr }) as unknown as ChildProcess
    manager.attachSidecarProcessLogs(child)
    stdout.write('INFO: authorization: Bear')
    stdout.write('er dummy-secret\nINFO: GET /health HTTP/1.1" 200 OK\n')
    stderr.end('WARNING: token=dummy-tail C:\\private\\file.pdf')
    stdout.end()
    await new Promise<void>((resolve) => setImmediate(resolve))
    const content = fs.readFileSync(path.join(logDir, 'sidecar.log'), 'utf8')
    expect(content).toContain('[WARN]')
    expect(content).toContain('GET /health')
    expect(content).not.toContain('dummy-secret')
    expect(content).not.toContain('dummy-tail')
    expect(content).not.toContain('private')
    const messages = diagnostics.mock.calls.map((call) => call[2]).join('\n')
    expect(messages).toContain('[redacted]')
    expect(messages).not.toContain('dummy-secret')
    expect(messages).not.toContain('dummy-tail')
    expect(messages).not.toContain('GET /health')
  })

  it('handles failed log pipes without an unhandled interface error', () => {
    const manager = isolatedManager()
    const diagnostics = vi.spyOn(logger, 'log')
    const stdout = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdout }) as unknown as ChildProcess
    manager.attachSidecarProcessLogs(child)
    expect(() => stdout.emit('error', new Error('Read failed: token=dummy-pipe'))).not.toThrow()
    expect(diagnostics).toHaveBeenCalledWith('WARN', 'Sidecar', expect.stringContaining('stdout log stream failed'))
    stdout.end()
  })
})

describe('SidecarProcessManager process state', () => {
  afterEach(() => vi.restoreAllMocks())

  function unavailableHealth() {
    vi.spyOn(http, 'get').mockImplementation(() => {
      const request = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() }) as unknown as http.ClientRequest
      queueMicrotask(() => request.emit('error', new Error('ECONNREFUSED')))
      return request
    })
  }

  it('keeps preparation checking across failed probes and shares concurrent startup', async () => {
    unavailableHealth()
    const manager = new SidecarProcessManager()
    let finish!: (online: boolean) => void
    const internals = manager as unknown as { launchPythonSidecar(): Promise<boolean> }
    const launch = vi.spyOn(internals, 'launchPythonSidecar').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const first = manager.startPythonSidecar()
    expect(manager.startPythonSidecar()).toBe(first)
    expect(launch).toHaveBeenCalledOnce()
    expect(await manager.checkSidecarHealth()).toBe(false)
    expect(manager.getSidecarState()).toMatchObject({ status: 'checking' })
    finish(false)
    expect(await first).toBe(false)
    expect(manager.getSidecarState()).toMatchObject({ status: 'offline', error: 'ECONNREFUSED' })
  })

  it('reports a failed probe offline after successful startup instead of hiding a later outage', async () => {
    unavailableHealth()
    const manager = new SidecarProcessManager()
    const internals = manager as unknown as { state: { status: string }; launchPythonSidecar(): Promise<boolean> }
    vi.spyOn(internals, 'launchPythonSidecar').mockImplementation(async () => {
      internals.state = { status: 'online' }
      return true
    })
    expect(await manager.startPythonSidecar()).toBe(true)
    expect(manager.getSidecarState().status).toBe('online')
    expect(await manager.checkSidecarHealth()).toBe(false)
    expect(manager.getSidecarState()).toMatchObject({ status: 'offline', error: 'ECONNREFUSED' })
  })

  it('clears a rejected startup so an explicit retry can succeed', async () => {
    const manager = new SidecarProcessManager()
    const internals = manager as unknown as { state: { status: string }; launchPythonSidecar(): Promise<boolean> }
    const launch = vi.spyOn(internals, 'launchPythonSidecar').mockRejectedValueOnce(new Error('fixture preparation failed'))
    await expect(manager.startPythonSidecar()).rejects.toThrow('fixture preparation failed')
    expect(manager.getSidecarState().status).toBe('offline')
    launch.mockImplementationOnce(async () => {
      internals.state = { status: 'online' }
      return true
    })
    expect(await manager.startPythonSidecar()).toBe(true)
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('marks an online sidecar offline when its owned process exits', () => {
    const manager = new SidecarProcessManager()
    const internals = manager as unknown as { state: { status: string }; markProcessExited(code: number): void }
    internals.state = { status: 'online' }

    internals.markProcessExited(1)

    expect(manager.getSidecarState()).toEqual({ status: 'offline', error: 'Process exited with code 1' })
  })
})

describe('SidecarProcessManager stderr severity', () => {
  it('keeps routine Uvicorn stderr lifecycle and access records informational', () => {
    expect(classifySidecarStderr('INFO:     Started server process [1234]')).toBe('INFO')
    expect(classifySidecarStderr('INFO:     Application startup complete.\nINFO:     Uvicorn running on http://127.0.0.1:8000')).toBe('INFO')
    expect(classifySidecarStderr('INFO:     127.0.0.1:50123 - "GET /health HTTP/1.1" 200 OK')).toBe('INFO')
  })

  it('preserves warnings and promotes errors or tracebacks', () => {
    expect(classifySidecarStderr('WARNING:  Retry scheduled')).toBe('WARN')
    expect(classifySidecarStderr('ERROR:    Application startup failed.')).toBe('ERROR')
    expect(classifySidecarStderr('Traceback (most recent call last):\n  File "main.py", line 1')).toBe('ERROR')
    expect(classifySidecarStderr('unclassified diagnostic')).toBe('WARN')
  })
})
