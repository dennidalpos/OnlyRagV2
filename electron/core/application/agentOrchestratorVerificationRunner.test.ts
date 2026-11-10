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

  it('runs the configured Python check without a Node dependency scan', async () => {
    write('requirements.txt', 'pytest\n')
    write('pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n')
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(scanWorkspaceDependencies).not.toHaveBeenCalled()
    expect(result.status).toBe('verified')
    expect(result.verifiedCommands).toEqual(['python -B -m pytest -q -p no:cacheprovider'])
    expect(execute).toHaveBeenCalledOnce()
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

  it('treats an unrecognized custom check as structural and requires observed tests for behavioral milestones', async () => {
    nodeProject()
    execute.mockResolvedValue({ code: 0, stdout: 'custom check complete', stderr: '' })
    expect(await runProjectVerification(root)).toMatchObject({ status: 'verified', evidenceLevel: 'structural' })
    const result = await runProjectVerification(root, undefined, undefined, false, [
      { id: 'behavior', title: 'Behavioral test', status: 'pending', verificationCommand: 'npm run test' },
    ])
    expect(result.status).toBe('unverifiable')
    expect(result.passed).toBeUndefined()
    expect(result.failureDetail).toContain('executed tests')
    expect(result.verifiedCommands).toBeUndefined()
  })

  it.each([
    ['', 'structural'],
    ['? fixture [no test files]', 'structural'],
    [JSON.stringify({ Action: 'pass', Package: 'fixture' }), 'structural'],
    [JSON.stringify({ Action: 'skip', Package: 'fixture', Test: 'TestSkip' }), 'structural'],
    [JSON.stringify({ Action: 'pass', Package: 'fixture', Test: 'TestReal' }), 'behavioral'],
  ])('classifies observed Go test evidence for %s', async (stdout, evidenceLevel) => {
    write('go.mod', 'module example.com/fixture\n')
    execute.mockResolvedValue({ code: 0, stdout, stderr: '' })
    expect(await runProjectVerification(root)).toMatchObject({ status: 'verified', evidenceLevel })
  })

  it('runs the offered test as well as a primary build when a milestone requires its behavioral proof', async () => {
    write('package.json', JSON.stringify({ scripts: { build: 'node build.cjs', test: 'node --test' } }))
    execute
      .mockResolvedValueOnce({ code: 0, stdout: 'build complete', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '# tests 1\n# pass 1\n# fail 0', stderr: '' })
    const result = await runProjectVerification(root, undefined, undefined, false, [
      { id: 'behavior', title: 'Behavioral test', status: 'pending', verificationCommand: 'npm run test' },
    ])
    expect(result).toMatchObject({ status: 'verified', verifiedCommands: ['npm run build', 'npm run test'] })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[0][0]).toContain(root.replace(/'/g, "''"))
  })

  it('does not certify an absent declared package manager or fall back to npm', async () => {
    write('package.json', JSON.stringify({ name: 'fixture', packageManager: 'yarn@4.0.0', scripts: { test: 'node verify.cjs' } }))
    execute.mockResolvedValue({ code: 127, stdout: '', stderr: 'VERIFICATION_TOOL_UNAVAILABLE:yarn' })
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(result.status).toBe('unverifiable')
    expect(result.command).toContain('yarn run test')
    expect(verifyWebUi).not.toHaveBeenCalled()
    expect(execute.mock.calls[0][0]).toContain('COREPACK_ENABLE_NETWORK')
  })

  it('does not certify a discovered project without a terminating verification command', async () => {
    nodeProject()
    write('server/requirements.txt', 'pytest\n')
    const result = await runProjectVerification(root, undefined, undefined, true)
    expect(result.status).toBe('unverifiable')
    expect(result.failureDetail).toContain('server')
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not let a Node script certify an unchecked Python stack in the same directory', async () => {
    nodeProject()
    write('requirements.txt', 'fastapi\n')
    const result = await runProjectVerification(root)
    expect(result.status).toBe('unverifiable')
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires both native checks for a project declaring multiple native manifests', async () => {
    write('go.mod', 'module example.com/test\n')
    write('Cargo.toml', '[package]\nname="test"\nversion="0.1.0"')
    execute.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }).mockResolvedValueOnce({ code: 1, stdout: 'native failure', stderr: '' })
    const result = await runProjectVerification(root)
    expect(result.status).toBe('failed')
    expect(execute).toHaveBeenCalledTimes(2)
    expect(result.failureDetail).toContain('native failure')
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
