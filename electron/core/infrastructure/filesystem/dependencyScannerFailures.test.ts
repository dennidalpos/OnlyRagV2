import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import depcheck from 'depcheck'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanWorkspaceDependencies } from './dependencyScanner'

vi.mock('depcheck', () => ({ default: vi.fn() }))

describe('dependency scan failures', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-scan-failure-'))
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}')
    vi.resetAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('refuses a result with inaccessible directories', async () => {
    vi.mocked(depcheck).mockResolvedValue({ invalidDirs: { src: new Error('EACCES') }, missing: {} } as never)
    expect(await scanWorkspaceDependencies(root)).toEqual({ scanned: false, missing: {} })
  })

  it('clears its deadline when the scanner rejects', async () => {
    vi.mocked(depcheck).mockRejectedValue(new Error('scanner unavailable'))
    const setTimer = vi.spyOn(globalThis, 'setTimeout')
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    expect(await scanWorkspaceDependencies(root, 1234)).toEqual({ scanned: false, missing: {} })
    const index = setTimer.mock.calls.findIndex((call) => call[1] === 1234)
    expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[index].value)
  })

  it('keeps timeout evidence unavailable when the scan settles later', async () => {
    let settle: (result: depcheck.Results) => void = () => {
      throw new Error('Scanner was not invoked')
    }
    vi.mocked(depcheck).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    const result = await scanWorkspaceDependencies(root, 5)
    expect(result).toEqual({ scanned: false, missing: {} })
    settle({ missing: {}, invalidFiles: {}, invalidDirs: {} } as depcheck.Results)
    await Promise.resolve()
    expect(result.scanned).toBe(false)
  })
})
