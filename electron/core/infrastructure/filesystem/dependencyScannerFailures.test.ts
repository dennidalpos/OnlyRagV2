import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import depcheck from 'depcheck'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanWorkspaceDependencies } from './dependencyScanner'
import { scanDependencyFiles } from './dependencyScanFiles'
import { dependencyScanWorker } from '../process/dependencyScanWorkerClient'

vi.mock('depcheck', () => ({ default: vi.fn() }))
vi.mock('../process/dependencyScanWorkerClient', () => ({ dependencyScanWorker: { scan: vi.fn() } }))

describe('dependency scan failures', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-scan-failure-'))
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}')
    vi.resetAllMocks()
    vi.mocked(dependencyScanWorker.scan).mockResolvedValue({ missing: {}, scanned: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('refuses a result with inaccessible directories', async () => {
    vi.mocked(depcheck).mockResolvedValue({ invalidDirs: { src: new Error('EACCES') }, missing: {} } as never)
    await expect(scanDependencyFiles(root)).rejects.toThrow('incomplete')
  })

  it('refuses worker failure without invoking the in-process parser', async () => {
    vi.mocked(dependencyScanWorker.scan).mockRejectedValue(new Error('scanner unavailable'))
    expect(await scanWorkspaceDependencies(root, 1234)).toEqual({ scanned: false, missing: {} })
    expect(depcheck).not.toHaveBeenCalled()
  })

  it('does not dispatch absent or already cancelled workspace requests', async () => {
    await expect(scanWorkspaceDependencies(null)).resolves.toEqual({ scanned: false, missing: {} })
    const controller = new AbortController()
    controller.abort()
    await expect(scanWorkspaceDependencies(root, 1234, controller.signal)).resolves.toEqual({ scanned: false, missing: {} })
    expect(dependencyScanWorker.scan).not.toHaveBeenCalled()
  })

  it('forwards the deadline and operation cancellation to the worker', async () => {
    const controller = new AbortController()
    expect((await scanWorkspaceDependencies(root, 1234, controller.signal)).scanned).toBe(true)
    expect(dependencyScanWorker.scan).toHaveBeenCalledWith(root, 1234, controller.signal)
  })
})
