import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PersistentPowerShellSession } from './persistentPowerShellSession'

/** Cases that spawn a real powershell.exe: it exists only on Windows, so other hosts report them as skipped. */
const itWithPowerShell = it.skipIf(process.platform !== 'win32')

describe('PersistentPowerShellSession Unit Tests', () => {
  let session: PersistentPowerShellSession | null = null

  afterEach(() => {
    if (session) {
      session.dispose()
      session = null
    }
  })

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
    // Long form: PowerShell reports the long path, while a runner's TEMP may be an 8.3 short name (RUNNER~1).
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-shell-cwd-')))
    fs.mkdirSync(path.join(root, 'src'))
    try {
      // Started outside root: the shell process keeps its start directory until it exits, and
      // Windows refuses to delete a directory a live process stands in.
      session = new PersistentPowerShellSession(os.tmpdir())
      await session.execute(`Set-Location -LiteralPath '${root}'`)
      expect(path.resolve(session.currentDirectory)).toBe(path.resolve(root))

      await session.execute('Set-Location src')
      expect(path.resolve(session.currentDirectory)).toBe(path.resolve(root, 'src'))
    } finally {
      session?.dispose()
      session = null
      fs.rmSync(root, { recursive: true, force: true })
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
