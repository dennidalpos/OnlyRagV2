import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ProcessToolService } from './processToolService'

// Host-native paths: the resolver uses node:path, so a literal C:\ is only absolute on Windows.
const hostRoot = path.parse(process.cwd()).root

function createService(execute: (...args: never[]) => Promise<unknown>) {
  return new ProcessToolService({
    getShellSession: () => ({ execute }) as never,
  })
}

describe('ProcessToolService run_command', () => {
  it('rejects structured tool names and blocking servers during preflight', () => {
    const service = createService(vi.fn())

    expect(service.validateRunCommandPreconditions('write_file src/App.tsx')).toMatchObject({
      isTerminal: true,
      outputForHistory: expect.stringContaining('[TOOL_AS_SHELL_BLOCK]'),
    })
    expect(service.validateRunCommandPreconditions('npm run dev')).toMatchObject({
      isTerminal: true,
      outputForHistory: expect.stringContaining('[BLOCKING_DEV_SERVER_BLOCK]'),
    })
    expect(service.validateRunCommandPreconditions('npm test')).toBeNull()
  })

  it('blocks unsafe commands before spawning the shell', async () => {
    const execute = vi.fn()
    const result = await createService(execute).executeRunCommand(
      `Remove-Item -Recurse -Force ${hostRoot}`,
      path.join(hostRoot, 'workspace'),
      undefined,
      undefined,
      undefined,
      undefined,
    )

    expect(result).toMatchObject({ isTerminal: true })
    expect((result as { outputForHistory: string }).outputForHistory).toContain('[SECURITY GUARDRAIL BLOCK]')
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires a gate approval before spawning a confined mutation', async () => {
    const execute = vi.fn()
    const result = await createService(execute).executeRunCommand(
      'Set-Content -Path src\\state.txt -Value ready',
      'C:\\workspace',
      undefined,
      undefined,
      undefined,
      undefined,
    )

    expect((result as { outputForHistory: string }).outputForHistory).toContain('[SECURITY APPROVAL REQUIRED]')
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

  it('rejects an unknown npm package during install preflight', async () => {
    const service = new ProcessToolService({
      getShellSession: () => ({ execute: vi.fn() }) as never,
      lookupPackages: async (names) => names.map((name) => ({ name, exists: false })),
    })

    const result = await service.validateInstallPreconditions('npm install package-that-does-not-exist', 'C:\\workspace')

    expect(result).toMatchObject({
      isTerminal: true,
      outputForHistory: expect.stringContaining('[PACKAGE DOES NOT EXIST'),
    })
  })

  it('skips an install when every requested package is declared and present on disk', async () => {
    const service = new ProcessToolService({
      getShellSession: () => ({ execute: vi.fn() }) as never,
      readPackageJson: async () => JSON.stringify({ dependencies: { react: '^19.0.0' } }),
      missingFromNodeModules: () => [],
    })

    const result = await service.validateRedundantInstall('npm install react', 'C:\\workspace')

    expect(result).toMatchObject({
      isTerminal: true,
      outputForHistory: expect.stringContaining('[REDUNDANT_INSTALL_SKIP]'),
    })
  })

  it('builds deterministic directives for invalid npm names and interactive prompts', () => {
    const service = createService(vi.fn())
    const directives = service.buildInteractionFailureDirectives('npm naming restrictions apply', true)

    expect(directives.npmNamingDirective).toContain('[NPM NAMING RESTRICTION DIRECTIVE]')
    expect(directives.interactivePromptDirective).toContain('[INTERACTIVE PROMPT DIRECTIVE]')
  })

  it('builds a bounded terminal auto-healing result', () => {
    const service = createService(vi.fn())
    const result = service.buildAutoHealingFailureResult(
      'npm test',
      { stdout: '', stderr: '', code: 1, timedOut: true } as never,
      'failure details',
      '\n\n[DIRECTIVE]',
      'Fix the command.',
    )

    expect(result).toMatchObject({ isTerminal: true, logDetail: 'failure details', effectOutcome: 'uncertain' })
    expect(result.outputForHistory).toContain('Exit Code: 1 - TIMED OUT')
    expect(result.outputForHistory).toContain('[DIRECTIVE]')
    expect(result.outputForHistory).toContain('[UNCERTAIN EFFECT - DO NOT RETRY]')
  })
})

describe('ProcessToolService inspect_os_env', () => {
  it('returns host facts and the probed toolchain inventory', () => {
    const service = new ProcessToolService({
      getShellSession: () => ({ execute: vi.fn() }) as never,
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
      getShellSession: () => ({ execute }) as never,
      probeVersion: () => null,
      platform: 'win32',
    }).executeEnsureTool({ toolName: 'docker' }, 'C:\\workspace', true, undefined, undefined, undefined)

    expect(result.outputForHistory).toContain('ENSURE_TOOL REJECTED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('stops before installation when terminal execution is disabled', async () => {
    const execute = vi.fn()
    const result = await new ProcessToolService({
      getShellSession: () => ({ execute }) as never,
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
      getShellSession: () => ({ execute, refreshEnvironmentPath }) as never,
      probeVersion: () => (++probeCount === 1 ? null : '9.8.7'),
      platform: 'win32',
    }).executeEnsureTool({ toolName: 'pnpm' }, 'C:\\workspace', true, signal, undefined, undefined)

    expect(result.outputForHistory).toContain('Successfully installed pnpm')
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('winget install --id pnpm.pnpm'), expect.any(Function), undefined, 600_000, signal)
    expect(refreshEnvironmentPath).toHaveBeenCalledOnce()
  })

  it('returns a terminal failure when post-install verification still cannot find the tool', async () => {
    const execute = vi.fn(async () => ({ stdout: 'installer output', stderr: '', code: 1 }))
    const result = await new ProcessToolService({
      getShellSession: () => ({ execute }) as never,
      probeVersion: () => null,
      platform: 'win32',
    }).executeEnsureTool({ toolName: 'git' }, 'C:\\workspace', true, undefined, undefined, undefined)

    expect(result.outputForHistory).toContain('ENSURE_TOOL INSTALL FAILED')
    expect(result.outputForHistory).toContain('installer output')
    expect(result.isTerminal).toBe(true)
  })
})

describe('ProcessToolService ETARGET on a range package.json declares', () => {
  const etarget = 'npm error code ETARGET\nnpm error notarget No matching version found for react@^19.8.0.'
  const facts = [
    { name: 'react', exists: true, latest: '19.3.0', versions: ['19.3.0'] },
    { name: 'react-dom', exists: true, latest: '19.3.0', versions: ['19.3.0'] },
  ]

  function serviceWithManifest(manifest: object | null) {
    return new ProcessToolService({
      getShellSession: () => ({ execute: vi.fn() }) as never,
      readPackageJson: async () => (manifest ? JSON.stringify(manifest) : null),
      lookupPackages: async (names) => facts.filter((f) => names.includes(f.name)),
      lookupPackage: async (name) => facts.find((f) => f.name === name) ?? { name, exists: false },
    })
  }

  it('orders one manifest rewrite that fixes every unpublished range, not an install of the first one', async () => {
    const service = serviceWithManifest({ dependencies: { react: '^19.8.0', 'react-dom': '^19.8.0' } })

    const { versionNotFoundDirective } = await service.classifyFailureDiagnostics(etarget, 'C:\workspace')

    expect(versionNotFoundDirective).toContain('[THESE VERSION RANGES MATCH NO PUBLISHED RELEASE]')
    expect(versionNotFoundDirective).toContain('react: you declared ^19.8.0')
    expect(versionNotFoundDirective).toContain('react-dom: you declared ^19.8.0')
    expect(versionNotFoundDirective).toContain('MUST be "write_file" on "package.json"')
  })

  it('keeps the install directive when the refused range came from the command, not the manifest', async () => {
    const service = serviceWithManifest({ dependencies: { vite: '^5.0.0' } })

    const { versionNotFoundDirective } = await service.classifyFailureDiagnostics(etarget, 'C:\workspace')

    expect(versionNotFoundDirective).toContain('npm install react@19.3.0')
  })
})
