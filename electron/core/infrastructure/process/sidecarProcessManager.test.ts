import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn(() => process.cwd()),
    isPackaged: false,
  },
}))

import { classifySidecarStderr, migrateLegacyNestedSidecarData, SidecarProcessManager } from './sidecarProcessManager'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('SidecarProcessManager process state', () => {
  it('marks an online sidecar offline when its owned process exits', () => {
    const manager = new SidecarProcessManager()
    ;(manager as any).state = { status: 'online' }

    ;(manager as any).markProcessExited(1)

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

describe('SidecarProcessManager data directory migration', () => {
  it('moves legacy nested data into the canonical directory', () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-sidecar-data-'))
    temporaryRoots.push(userDataDir)
    const legacyStore = path.join(userDataDir, 'data', 'data', 'lancedb_store')
    fs.mkdirSync(legacyStore, { recursive: true })
    fs.writeFileSync(path.join(legacyStore, 'table.lance'), 'test')

    const result = migrateLegacyNestedSidecarData(userDataDir)

    expect(result).toEqual({ moved: ['lancedb_store'], conflicts: [] })
    expect(fs.existsSync(path.join(userDataDir, 'data', 'lancedb_store', 'table.lance'))).toBe(true)
    expect(fs.existsSync(path.join(userDataDir, 'data', 'data'))).toBe(false)
  })

  it('does not overwrite a canonical entry when legacy data conflicts', () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-sidecar-data-'))
    temporaryRoots.push(userDataDir)
    const canonicalStore = path.join(userDataDir, 'data', 'lancedb_store')
    const legacyStore = path.join(userDataDir, 'data', 'data', 'lancedb_store')
    fs.mkdirSync(canonicalStore, { recursive: true })
    fs.mkdirSync(legacyStore, { recursive: true })
    fs.writeFileSync(path.join(canonicalStore, 'canonical.lance'), 'canonical')
    fs.writeFileSync(path.join(legacyStore, 'legacy.lance'), 'legacy')

    const result = migrateLegacyNestedSidecarData(userDataDir)

    expect(result).toEqual({ moved: [], conflicts: ['lancedb_store'] })
    expect(fs.readFileSync(path.join(canonicalStore, 'canonical.lance'), 'utf8')).toBe('canonical')
    expect(fs.readFileSync(path.join(legacyStore, 'legacy.lance'), 'utf8')).toBe('legacy')
  })
})
