import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { PersistentPowerShellSession } from './persistentPowerShellSession'
import { withVerificationEnvironment } from './powerShellCommand'
import { resolveVerificationCommands } from '../../domain/agent/projectVerificationResolver'
import { readWorkspaceManifest } from '../filesystem/workspaceManifestReader'

/** Cases that spawn a real powershell.exe: it exists only on Windows, so other hosts report them as skipped. */
const itWithPowerShell = it.skipIf(process.platform !== 'win32')

/** taskkill is asynchronous: retries until Windows releases a directory a disposed shell stood in. */
async function removeWhenReleased(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

describe('PersistentPowerShellSession Unit Tests', () => {
  let session: PersistentPowerShellSession | null = null

  afterEach(() => {
    if (session) {
      session.dispose()
      session = null
    }
  })

  itWithPowerShell('scopes verification download refusal and restores environment after failure', async () => {
    session = new PersistentPowerShellSession(process.cwd())
    await session.execute("$env:COREPACK_ENABLE_NETWORK = 'fixture-original'; $env:npm_config_pm_on_fail = $null")
    const run = await session.execute(
      withVerificationEnvironment("Write-Output $env:COREPACK_ENABLE_NETWORK; Write-Output $env:npm_config_pm_on_fail; node -e 'process.exit(7)'"),
    )
    expect(run.code).toBe(7)
    expect(run.stdout).toContain('0')
    expect(run.stdout).toContain('error')
    const restored = await session.execute("Write-Output $env:COREPACK_ENABLE_NETWORK; Write-Output ('restored:' + ($null -eq $env:npm_config_pm_on_fail))")
    expect(restored.stdout).toContain('fixture-original')
    expect(restored.stdout).toContain('restored:True')
    const unavailable = await session.execute(withVerificationEnvironment('onlyrag_fixture_missing_tool_20261013'))
    expect(unavailable.code).not.toBe(0)
    await session.execute("$env:PATH = ''")
    const absentManager = await session.execute(withVerificationEnvironment('yarn run test'))
    expect(absentManager.code).toBe(127)
    expect(absentManager.stderr).toContain('VERIFICATION_TOOL_UNAVAILABLE:yarn')
  })

  itWithPowerShell('binds verification to its root and restores cwd after failure or a script cd', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onlyrag-verify root's-"))
    fs.mkdirSync(path.join(root, 'child'))
    try {
      session = new PersistentPowerShellSession(root)
      await session.execute("Set-Location -LiteralPath 'child'")
      const failed = await session.execute(withVerificationEnvironment("Write-Output (Get-Location).ProviderPath; node -e 'process.exit(7)'", root))
      expect(failed.code).toBe(7)
      expect(failed.stdout).toBe(root)
      expect(session.currentDirectory).toBe(path.join(root, 'child'))
      const changed = await session.execute(withVerificationEnvironment("Set-Location -LiteralPath 'child'; Write-Output (Get-Location).ProviderPath", root))
      expect(changed.code).toBe(0)
      expect(changed.stdout).toBe(path.join(root, 'child'))
      expect(session.currentDirectory).toBe(path.join(root, 'child'))
      const unavailable = await session.execute(withVerificationEnvironment("Write-Output 'MUST_NOT_EXECUTE'", path.join(root, 'absent')))
      expect(unavailable.code).not.toBe(0)
      expect(unavailable.stdout).not.toContain('MUST_NOT_EXECUTE')
      expect(session.currentDirectory).toBe(path.join(root, 'child'))
    } finally {
      session?.dispose()
      session = null
      await removeWhenReleased(root)
    }
  })

  itWithPowerShell(
    'runs available native npm/pnpm scripts or refuses absent tools without acquisition',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-native-manager-'))
      let requests = 0
      const server = http.createServer((_, response) => {
        requests++
        response.writeHead(500)
        response.end('No fixture downloads are permitted')
      })
      try {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
        session = new PersistentPowerShellSession(root)
        await session.execute(`$env:npm_config_registry = 'http://127.0.0.1:${address.port}'`)
        const checker =
          "const fs=require('node:fs'); if(fs.readFileSync('input.txt','utf8')!=='fixture-original') throw new Error('Changed source'); console.log('SOURCE_READBACK_OK')"
        fs.writeFileSync(path.join(root, 'verify.cjs'), checker)
        fs.writeFileSync(path.join(root, 'input.txt'), 'fixture-original')
        let testedPnpm = false
        for (const manager of ['npm', 'pnpm']) {
          const available = await session.execute(`Write-Output ([bool](Get-Command '${manager}' -CommandType Application -ErrorAction SilentlyContinue))`)
          expect(available.code).toBe(0)
          if (!available.stdout.includes('True')) {
            const absent = await session.execute(withVerificationEnvironment(`${manager} run test`))
            expect(absent.code).toBe(127)
            expect(absent.stderr).toContain(`VERIFICATION_TOOL_UNAVAILABLE:${manager}`)
            continue
          }
          const version = await session.execute(withVerificationEnvironment(`${manager} --version`), undefined, undefined, 10000)
          expect(version.code).toBe(0)
          const match = version.stdout.match(/\b\d+\.\d+\.\d+\b/)
          if (!match) throw new Error(`No native ${manager} version`)
          fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({
              packageManager: `${manager}@${match[0]}`,
              scripts: { test: 'node verify.cjs' },
              ...(manager === 'pnpm' ? { dependencies: { semver: `file:${path.resolve('node_modules/semver').replace(/\\/g, '/')}` } } : {}),
            }),
          )
          if (manager === 'pnpm') {
            testedPnpm = true
            // Native preparation uses the existing local semver package, with no network or app dependency change.
            const prepared = await session.execute('pnpm --pm-on-fail=error --runtime-on-fail=error install --offline', undefined, undefined, 10000)
            expect(prepared.code).toBe(0)
          }
          const commands = resolveVerificationCommands(readWorkspaceManifest(root))
          expect(commands[0].command).toBe(`${manager} run test`)
          const result = await session.execute(withVerificationEnvironment(commands[0].command), undefined, undefined, 10000)
          expect(result.code, result.stdout + result.stderr).toBe(0)
          expect(result.stdout).toContain('SOURCE_READBACK_OK')
          fs.unlinkSync(path.join(root, 'package.json'))
        }
        if (testedPnpm) {
          const retainedLock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))
          fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@0.0.0', scripts: { test: 'node verify.cjs' } }))
          const refused = await session.execute(withVerificationEnvironment('pnpm run test'), undefined, undefined, 10000)
          expect(refused.code).not.toBe(0)
          expect(refused.stdout + refused.stderr).toMatch(/version|pnpm/i)
          expect(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))).toEqual(retainedLock)
        }
        expect(requests).toBe(0)
        expect(fs.readFileSync(path.join(root, 'input.txt'), 'utf8')).toBe('fixture-original')
        expect(fs.readdirSync(root).sort()).toEqual(
          testedPnpm ? ['input.txt', 'node_modules', 'package.json', 'pnpm-lock.yaml', 'verify.cjs'] : ['input.txt', 'verify.cjs'],
        )
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
        session?.dispose()
        session = null
        await removeWhenReleased(root)
      }
    },
    20000,
  )

  itWithPowerShell('should execute basic PowerShell command and capture stdout', async () => {
    session = new PersistentPowerShellSession(process.cwd())
    const res = await session.execute('Write-Output "Hello Persistent Shell"')

    expect(res.code).toBe(0)
    expect(res.stdout).toContain('Hello Persistent Shell')
  })

  itWithPowerShell('should preserve environment variable state across sequential commands', async () => {
    session = new PersistentPowerShellSession(process.cwd())

    // Command 1: Set environment variable
    await session.execute('$env:ONLYRAG_TEST_VAR = "StatePreserved42"')

    // Command 2: Read environment variable back
    const res2 = await session.execute('Write-Output $env:ONLYRAG_TEST_VAR')

    expect(res2.code).toBe(0)
    expect(res2.stdout).toContain('StatePreserved42')
  })

  itWithPowerShell('reports the directory a cd left the shell in', async () => {
    // Compared resolved: a runner's TEMP may be an 8.3 short name (RUNNER~1), and the directory is
    // reported in the spelling of the workspace, here os.tmpdir().
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-shell-cwd-')))
    fs.mkdirSync(path.join(root, 'src'))
    try {
      // Started outside root: the shell process keeps its start directory until it exits, and
      // Windows refuses to delete a directory a live process stands in.
      session = new PersistentPowerShellSession(os.tmpdir())
      await session.execute(`Set-Location -LiteralPath '${root}'`)
      expect(fs.realpathSync.native(session.currentDirectory)).toBe(root)

      await session.execute('Set-Location src')
      expect(fs.realpathSync.native(session.currentDirectory)).toBe(path.join(root, 'src'))
    } finally {
      session?.dispose()
      session = null
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  itWithPowerShell('spells the directory like a workspace opened through a junction', async () => {
    // Same mismatch as an 8.3 short-name workspace: the shell reports the resolved path, the workspace keeps its own spelling.
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-shell-alias-')))
    const target = path.join(root, 'target')
    const workspace = path.join(root, 'workspace')
    fs.mkdirSync(path.join(target, 'src'), { recursive: true })
    fs.symlinkSync(target, workspace, 'junction')
    try {
      session = new PersistentPowerShellSession(workspace)
      await session.execute(`Set-Location -LiteralPath '${path.join(target, 'src')}'`)
      expect(session.currentDirectory).toBe(path.join(workspace, 'src'))

      await session.execute(`Set-Location -LiteralPath '${root}'`)
      expect(path.resolve(session.currentDirectory)).toBe(path.resolve(root))
    } finally {
      session?.dispose()
      session = null
      // The shell started inside the junction.
      await removeWhenReleased(root)
    }
  })

  itWithPowerShell('should preserve variable state across sequential commands', async () => {
    session = new PersistentPowerShellSession(process.cwd())

    // Step 1: define variable
    await session.execute('$myAccumulator = 100')

    // Step 2: increment and print
    const res = await session.execute('$myAccumulator += 50; Write-Output "Val: $myAccumulator"')

    expect(res.stdout).toContain('Val: 150')
  })

  itWithPowerShell('returns the failure reason on stderr alongside the banner the command wrote to stdout', async () => {
    session = new PersistentPowerShellSession(process.cwd())

    // Pins the contract the executor now depends on: BOTH streams come back populated.
    const res = await session.execute('Write-Output "BANNER_ON_STDOUT"; Write-Error "REASON_ON_STDERR"')

    expect(res.stdout).toContain('BANNER_ON_STDOUT')
    expect(res.stderr).toContain('REASON_ON_STDERR')
    expect(res.code).not.toBe(0)
  })

  itWithPowerShell('should abort immediately on an interactive prompt instead of waiting out the full timeout', async () => {
    session = new PersistentPowerShellSession(process.cwd())

    const startedAt = Date.now()
    // Emits a recognizable interactive-prompt pattern, then would hang on Start-Sleep if the guard did not abort first — a large timeoutMs proves the abort is prompt-triggered, not a coincidental timeout.
    const res = await session.execute('Write-Output "Overwrite existing file? [y/n]"; Start-Sleep -Seconds 30', undefined, undefined, 25000)
    const elapsedMs = Date.now() - startedAt

    expect(res.interruptedByPrompt).toBe(true)
    expect(res.code).toBe(130)
    expect(res.stderr).toContain('[INTERACTIVE PROMPT DETECTED]')
    expect(elapsedMs).toBeLessThan(20000)

    // The session must still be usable afterwards (process was recreated, not left wedged).
    const followUp = await session.execute('Write-Output "still alive"')
    expect(followUp.stdout).toContain('still alive')
  })

  it('returns a cancellation result immediately when AbortSignal is already aborted', async () => {
    session = new PersistentPowerShellSession(process.cwd())
    const controller = new AbortController()
    controller.abort()

    const res = await session.execute('Start-Sleep -Seconds 30', undefined, undefined, 25000, controller.signal)

    expect(res.code).toBe(130)
    expect(res.stderr).toContain('cancelled before execution')
  })

  itWithPowerShell('cancels an in-flight command and recreates the shell without leaving a residue', async () => {
    session = new PersistentPowerShellSession(process.cwd())
    const controller = new AbortController()
    const execution = session.execute('Start-Sleep -Seconds 30', undefined, undefined, 25000, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 250))
    controller.abort()

    const result = await execution
    expect(result.code).toBe(130)
    expect(result.stderr).toContain('cancelled by AbortSignal')
    expect(session.isExecuting()).toBe(false)

    const followUp = await session.execute('Write-Output "shell recreated after cancellation"')
    expect(followUp.code).toBe(0)
    expect(followUp.stdout).toContain('shell recreated after cancellation')
  })

  itWithPowerShell('times out an in-flight command and recreates the shell without leaving a residue', async () => {
    session = new PersistentPowerShellSession(process.cwd())

    const result = await session.execute('Start-Sleep -Seconds 30', undefined, undefined, 1000)
    expect(result.code).toBe(124)
    expect(result.timedOut).toBe(true)
    expect(result.stderr).toContain('timed out')
    expect(session.isExecuting()).toBe(false)

    const followUp = await session.execute('Write-Output "shell recreated after timeout"')
    expect(followUp.code).toBe(0)
    expect(followUp.stdout).toContain('shell recreated after timeout')
  })
})

describe('PersistentPowerShellSession output fidelity', () => {
  let session: PersistentPowerShellSession | null = null
  afterEach(() => {
    session?.dispose()
    session = null
  })

  itWithPowerShell('returns non-ASCII output intact, from PowerShell and from a native program', async () => {
    session = new PersistentPowerShellSession(process.cwd())
    const fromShell = await session.execute('Write-Output "città ✓ perché"')
    expect(fromShell.stdout).toContain('città ✓ perché')
    const fromNode = await session.execute('node -e "console.log(String.fromCodePoint(0x2713) + \' però\')"')
    expect(fromNode.stdout).toContain('✓ però')
  })

  itWithPowerShell('does not treat a finished log line that mentions a prompt as a prompt', async () => {
    session = new PersistentPowerShellSession(process.cwd())
    const res = await session.execute(
      'Write-Output "test: asks (y/n) before overwrite"; Start-Sleep -Milliseconds 500; Write-Output "done"',
      undefined,
      undefined,
      20000,
    )
    expect(res.interruptedByPrompt).toBeUndefined()
    expect(res.stdout).toContain('done')
    expect(res.code).toBe(0)
  })
})
