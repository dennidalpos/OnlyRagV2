import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PersistentPowerShellSession } from './persistentPowerShellSession'
import { TaskRunner } from './taskRunner'

const cases = [
  { command: 'Write-Output "A&&B"', output: 'A&&B', code: 0 },
  { command: "Write-Output 'A&&B'", output: 'A&&B', code: 0 },
  { command: 'Write-Output A`&`&B', output: 'A&&B', code: 0 },
  { command: 'Write-Output "A`"&&B"', output: 'A"&&B', code: 0 },
  { command: "Write-Output 'A''&&B'", output: "A'&&B", code: 0 },
  { command: 'Write-Output "$(Write-Output \'A&&B\')"', output: 'A&&B', code: 0 },
  { command: "node -e 'console.log(1 && 2)'", output: '2', code: 0 },
  { command: 'Write-Output @"\nA&&B\n"@', output: 'A&&B', code: 0 },
  { command: "Write-Output @'\nA&&B\n'@", output: 'A&&B', code: 0 },
  { command: 'Write-Output "A&&B" && Write-Output \'C&&D\'', output: 'A&&B\nC&&D', code: 0 },
  { command: 'Write-Output First && Write-Output Second && Write-Output Third', output: 'First\nSecond\nThird', code: 0 },
  { command: "node -e 'process.exit(7)' && Write-Output FORBIDDEN", output: '', code: 7 },
  { command: "Write-Output First && node -e 'process.exit(9)' && Write-Output FORBIDDEN", output: 'First', code: 9 },
  { command: 'Write-Error CONTROL_FAILURE && Write-Output FORBIDDEN', output: '', code: 1 },
  { command: 'Write-Output First && Write-Error CONTROL_FAILURE && Write-Output FORBIDDEN', output: 'First', code: 1 },
  { command: 'Write-Output First && Write-Error CONTROL_FAILURE', output: 'First', code: 1 },
  { command: 'Write-Output First && Write-Output Second; Write-Output Independent', output: 'First\nSecond\nIndependent', code: 0 },
  { command: 'Write-Output First && Write-Output Second # A&&B\nWrite-Output Independent', output: 'First\nSecond\nIndependent', code: 0 },
  { command: '& { Write-Output First && Write-Output Second }; Write-Output Independent', output: 'First\nSecond\nIndependent', code: 0 },
  { command: 'Write-Output First &&\n Write-Output Second', output: 'First\nSecond', code: 0 },
  { command: 'Write-Output First && Write-Output `\r\n Second', output: 'First\nSecond', code: 0 },
  { command: "${A&&B} = 'literal'; Write-Output ${A&&B}", output: 'literal', code: 0 },
  { command: 'Write-Output First && node --% -e "console.log(\'A&&B\')"', output: 'First\nA&&B', code: 0 },
]

describe.skipIf(process.platform !== 'win32').each(['session', 'terminal'] as const)('native PS 5.1 chain execution: %s', (executor) => {
  let session: PersistentPowerShellSession
  let runner: TaskRunner
  beforeAll(async () => {
    session = new PersistentPowerShellSession(process.cwd())
    runner = new TaskRunner()
    // Warm startup is separate from per-command timeouts on Windows hosts with slow process admission.
    if (executor === 'session') expect((await session.execute('Write-Output READY', undefined, undefined, 30000)).code).toBe(0)
    else expect((await runner.executeTerminalCommand('Write-Output READY', process.cwd(), undefined, 30000)).success).toBe(true)
  }, 45000)
  afterAll(() => {
    session.dispose()
    runner.cancelAllTasks()
  })

  it.each(cases)(
    '$command',
    async ({ command, output, code }) => {
      if (executor === 'session') {
        const result = await session.execute(command, undefined, undefined, 30000)
        expect(result.code).toBe(code)
        expect(result.stdout.replace(/\r\n/g, '\n')).toBe(output)
        expect(result.stdout).not.toContain('FORBIDDEN')
      } else {
        const result = await runner.executeTerminalCommand(command, process.cwd(), undefined, 30000)
        expect(result.success).toBe(code === 0)
        if (output) expect(result.output.replace(/\r\n/g, '\n')).toContain(output)
        // PowerShell errors echo the source line; only a standalone output line means the leg ran.
        expect(result.output).not.toMatch(/^\s*FORBIDDEN\s*$/m)
        if (code) expect(result.error).toBeTruthy()
      }
    },
    45000,
  )
})
