import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { devToolProbeRepository } from './devToolProbeRepository'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  vi.mocked(childProcess.execFileSync).mockReset().mockImplementation(actual.execFileSync)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('native tool version probes', () => {
  it('invokes direct executable paths as one argument without a shell and retains the timeout', () => {
    const exec = vi.mocked(childProcess.execFileSync).mockReturnValue('v24.20.0\n')
    expect(devToolProbeRepository.probeVersion('C:/Program Files/Node/node.exe', ['--version'])).toBe('v24.20.0\n')
    expect(exec).toHaveBeenCalledWith(
      'C:/Program Files/Node/node.exe',
      ['--version'],
      expect.objectContaining({ timeout: 5000, shell: false, windowsHide: true }),
    )
  })

  it('keeps absent/failed tools unavailable', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('Unavailable')
    })
    expect(devToolProbeRepository.probeVersion('unavailable-tool', ['--version'])).toBeNull()
  })

  it('reads the actual Node version from the native executable', () => {
    expect(devToolProbeRepository.probeVersion(process.execPath, ['--version'])?.trim()).toBe(process.version)
  })

  it.skipIf(process.platform !== 'win32')('refuses non-version arguments before invoking a package-manager shell probe', () => {
    const exec = vi.mocked(childProcess.execFileSync).mockReturnValue('unexpected')
    expect(devToolProbeRepository.probeVersion('npm', ['--version', '& whoami'])).toBeNull()
    expect(exec).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform !== 'win32').each(['npm', 'pnpm'])('resolves a %s.cmd shim under a path with spaces and propagates failure', (binary) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag probe spaces '))
    const shim = path.join(directory, `${binary}.cmd`)
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH'
    vi.stubEnv(pathKey, `${directory}${path.delimiter}${process.env[pathKey] || ''}`)
    try {
      fs.writeFileSync(shim, '@echo off\r\nif "%~1"=="--version" (echo 7.8.9) else (exit /b 2)\r\n', 'utf8')
      expect(devToolProbeRepository.probeVersion(binary, ['--version'])?.trim()).toBe('7.8.9')
      fs.writeFileSync(shim, '@echo off\r\nexit /b 7\r\n', 'utf8')
      expect(devToolProbeRepository.probeVersion(binary, ['--version'])).toBeNull()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
