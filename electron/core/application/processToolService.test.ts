import { describe, expect, it, vi } from 'vitest'
import { ProcessToolService } from './processToolService'

function createService(execute: (...args: any[]) => Promise<any>) {
  return new ProcessToolService({
    getShellSession: () => ({ execute } as any),
  })
}

describe('ProcessToolService run_command', () => {
  it('blocks unsafe commands before spawning the shell', async () => {
    const execute = vi.fn()
    const result = await createService(execute).executeRunCommand('Remove-Item -Recurse -Force C:\\', 'C:\\workspace', undefined, undefined, undefined, undefined)

    expect(result).toMatchObject({ isTerminal: true })
    expect((result as { outputForHistory: string }).outputForHistory).toContain('[SECURITY GUARDRAIL BLOCK]')
    expect(execute).not.toHaveBeenCalled()
  })

  it('passes the resolved timeout and AbortSignal to the persistent shell', async () => {
    const signal = new AbortController().signal
    const execute = vi.fn(async () => ({ stdout: 'ok', stderr: '', code: 0 }))
    const result = await createService(execute).executeRunCommand('npm test', 'C:\\workspace', 12, signal, undefined, undefined)

    expect(result).toMatchObject({ isFailure: false, rawOutput: 'ok' })
    expect(execute).toHaveBeenCalledWith('npm test', expect.any(Function), undefined, 12_000, signal)
  })

  it('reports AbortSignal cancellation as a failed terminal execution', async () => {
    const execute = vi.fn(async () => ({ stdout: '', stderr: '[Operation cancelled by AbortSignal]', code: 130 }))
    const result = await createService(execute).executeRunCommand('npm test', 'C:\\workspace', undefined, new AbortController().signal, undefined, undefined)

    expect(result).toMatchObject({ isFailure: true, isCancelled: true })
  })
})

describe('ProcessToolService inspect_os_env', () => {
  it('returns host facts and the probed toolchain inventory', () => {
    const service = new ProcessToolService({
      getShellSession: () => ({ execute: vi.fn() } as any),
      probeToolchain: () => [
        { id: 'node', displayName: 'Node.js', installed: true, version: '24.20.0' },
        { id: 'python', displayName: 'Python', installed: false, version: '' },
      ],
    })

    const result = service.inspectOsEnvironment()

    expect(result.logMessage).toBe('Guest OS Environment & Toolchain Inventory')
    expect(result.outputForHistory).toContain('Guest OS Environment:')
    expect(result.outputForHistory).toContain('- node: OK (24.20.0)')
    expect(result.outputForHistory).toContain('- python: MISSING')
  })
})

describe('ProcessToolService ensure_tool', () => {
  it('rejects tools outside the closed allow-list without invoking the shell', async () => {
    const execute = vi.fn()
    const result = await new ProcessToolService({
      getShellSession: () => ({ execute } as any),
      probeVersion: () => null,
      platform: 'win32',
    }).executeEnsureTool({ toolName: 'docker' }, 'C:\\workspace', true, undefined, undefined, undefined)

    expect(result.outputForHistory).toContain('ENSURE_TOOL REJECTED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('stops before installation when terminal execution is disabled', async () => {
    const execute = vi.fn()
    const result = await new ProcessToolService({
      getShellSession: () => ({ execute } as any),
      probeVersion: () => null,
      platform: 'win32',
    }).executeEnsureTool({ toolName: 'pnpm' }, 'C:\\workspace', false, undefined, undefined, undefined)

    expect(result.outputForHistory).toContain('terminal execution is disabled')
    expect(execute).not.toHaveBeenCalled()
  })

  it('uses the install timeout, refreshes PATH, and verifies the installed tool', async () => {
    const execute = vi.fn(async () => ({ stdout: 'installed', stderr: '', code: 0 }))
    const refreshEnvironmentPath = vi.fn()
    const signal = new AbortController().signal
    let probeCount = 0
    const result = await new ProcessToolService({
      getShellSession: () => ({ execute, refreshEnvironmentPath } as any),
      probeVersion: () => (++probeCount === 1 ? null : '9.8.7'),
      platform: 'win32',
    }).executeEnsureTool({ toolName: 'pnpm' }, 'C:\\workspace', true, signal, undefined, undefined)

    expect(result.outputForHistory).toContain('Successfully installed pnpm')
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('winget install --id pnpm.pnpm'),
      expect.any(Function),
      undefined,
      600_000,
      signal,
    )
    expect(refreshEnvironmentPath).toHaveBeenCalledOnce()
  })

  it('returns a terminal failure when post-install verification still cannot find the tool', async () => {
    const execute = vi.fn(async () => ({ stdout: 'installer output', stderr: '', code: 1 }))
    const result = await new ProcessToolService({
      getShellSession: () => ({ execute } as any),
      probeVersion: () => null,
      platform: 'win32',
    }).executeEnsureTool({ toolName: 'git' }, 'C:\\workspace', true, undefined, undefined, undefined)

    expect(result.outputForHistory).toContain('ENSURE_TOOL INSTALL FAILED')
    expect(result.outputForHistory).toContain('installer output')
    expect(result.isTerminal).toBe(true)
  })
})
