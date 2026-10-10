import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolExecutorService } from './agentToolExecutorService'
import { scanWorkspaceDependencies } from '../infrastructure/filesystem/dependencyScanner'
import { verifyWebUi } from '../infrastructure/process/webUiSmokeVerifier'
import { runProjectVerification } from './agentOrchestratorVerificationRunner'

vi.mock('./agentToolExecutorService', () => ({ agentToolExecutorService: { getOrCreateShellSession: vi.fn() } }))
vi.mock('../infrastructure/filesystem/dependencyScanner', () => ({ scanWorkspaceDependencies: vi.fn() }))
vi.mock('../infrastructure/process/webUiSmokeVerifier', () => ({ verifyWebUi: vi.fn() }))

describe('project verification dependency evidence', () => {
  let root: string
  const execute = vi.fn()

  function write(relativePath: string, content: string) {
    const filePath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }

  function nodeProject(relativePath = '.') {
    write(path.join(relativePath, 'package.json'), '{"name":"fixture","scripts":{"test":"node --test"}}')
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-verification-scan-'))
    vi.resetAllMocks()
    execute.mockResolvedValue({ code: 0, stdout: '', stderr: '', timedOut: false })
    vi.mocked(agentToolExecutorService.getOrCreateShellSession).mockReturnValue({ execute } as never)
    vi.mocked(scanWorkspaceDependencies).mockResolvedValue({ missing: {}, scanned: true })
    vi.mocked(verifyWebUi).mockResolvedValue({ status: 'not_applicable' })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('keeps unavailable dependency evidence unverifiable even with a passing shell fixture', async () => {
    nodeProject()
    vi.mocked(scanWorkspaceDependencies).mockResolvedValue({ missing: {}, scanned: false })
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(result.status).toBe('unverifiable')
    expect(result.passed).not.toBe(true)
    expect(result.failureDetail).toContain('dependency')
    expect(execute).not.toHaveBeenCalled()
  })

  it('scans a nested package when the workspace root has no package manifest', async () => {
    nodeProject('client')
    vi.mocked(scanWorkspaceDependencies).mockResolvedValue({ scanned: true, missing: { 'missing-library': [path.join(root, 'client/src/app.js')] } })
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(scanWorkspaceDependencies).toHaveBeenCalledWith(path.join(root, 'client'), undefined, undefined)
    expect(result.status).toBe('failed')
    expect(result.failureDetail).toContain('missing-library')
    expect(result.failureDetail).toContain('src/app.js')
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires dependency evidence from every discovered package before running commands', async () => {
    nodeProject()
    nodeProject('server')
    vi.mocked(scanWorkspaceDependencies).mockImplementation(async (workspace) => ({ scanned: workspace === root, missing: {} }))
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(result.status).toBe('unverifiable')
    expect(result.failureDetail).toContain('server')
    expect(scanWorkspaceDependencies).toHaveBeenCalledTimes(2)
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not require a Node dependency scan for a Python project without an available command', async () => {
    write('requirements.txt', 'pytest\n')
    write('pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n')
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(scanWorkspaceDependencies).not.toHaveBeenCalled()
    expect(result.status).toBe('unverifiable')
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not start verification after cancellation while the scan settles', async () => {
    nodeProject()
    const cancellation = new AbortController()
    vi.mocked(scanWorkspaceDependencies).mockImplementation(async () => {
      cancellation.abort()
      return { scanned: true, missing: {} }
    })
    const result = await runProjectVerification(root, undefined, cancellation.signal, true)
    expect(result.status).toBe('unverifiable')
    expect(execute).not.toHaveBeenCalled()
    expect(verifyWebUi).not.toHaveBeenCalled()
    expect(scanWorkspaceDependencies).toHaveBeenCalledWith(root, undefined, cancellation.signal)
  })

  it('preserves a successful declared command after complete dependency evidence', async () => {
    nodeProject()
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(result).toMatchObject({ status: 'verified', passed: true, verifiedCommands: ['npm run test'] })
  })

  it('does not certify a discovered project without a terminating verification command', async () => {
    nodeProject()
    write('server/requirements.txt', 'pytest\n')
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(result.status).toBe('unverifiable')
    expect(result.failureDetail).toContain('server')
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not certify a cancelled command after its successful result settles', async () => {
    nodeProject()
    const cancellation = new AbortController()
    execute.mockImplementation(async () => {
      cancellation.abort()
      return { code: 0, stdout: '', stderr: '', timedOut: false }
    })
    const result = await runProjectVerification(root, undefined, cancellation.signal, true)
    expect(result.status).toBe('unverifiable')
    expect(verifyWebUi).not.toHaveBeenCalled()
  })
})
