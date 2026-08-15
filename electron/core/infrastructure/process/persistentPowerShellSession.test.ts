import { describe, it, expect, afterEach } from 'vitest'
import { PersistentPowerShellSession } from './persistentPowerShellSession'

describe('PersistentPowerShellSession Unit Tests', () => {
  let session: PersistentPowerShellSession | null = null

  afterEach(() => {
    if (session) {
      session.dispose()
      session = null
    }
  })

  it('should execute basic PowerShell command and capture stdout', async () => {
    session = new PersistentPowerShellSession(process.cwd())
    const res = await session.execute('Write-Output "Hello Persistent Shell"')

    expect(res.code).toBe(0)
    expect(res.stdout).toContain('Hello Persistent Shell')
  })

  it('should preserve environment variable state across sequential commands', async () => {
    session = new PersistentPowerShellSession(process.cwd())
    
    // Command 1: Set environment variable
    await session.execute('$env:ONLYRAG_TEST_VAR = "StatePreserved42"')

    // Command 2: Read environment variable back
    const res2 = await session.execute('Write-Output $env:ONLYRAG_TEST_VAR')

    expect(res2.code).toBe(0)
    expect(res2.stdout).toContain('StatePreserved42')
  })

  it('should preserve variable state across sequential commands', async () => {
    session = new PersistentPowerShellSession(process.cwd())

    // Step 1: define variable
    await session.execute('$myAccumulator = 100')

    // Step 2: increment and print
    const res = await session.execute('$myAccumulator += 50; Write-Output "Val: $myAccumulator"')

    expect(res.stdout).toContain('Val: 150')
  })
})
