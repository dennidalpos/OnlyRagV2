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

import { migrateLegacyNestedSidecarData, SidecarProcessManager } from './sidecarProcessManager'

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
