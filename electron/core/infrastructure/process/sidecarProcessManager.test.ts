import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn(() => process.cwd()),
    isPackaged: false,
  },
}))

import { classifySidecarStderr, SidecarProcessManager } from './sidecarProcessManager'

describe('SidecarProcessManager process state', () => {
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
