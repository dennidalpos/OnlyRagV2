import { describe, expect, it } from 'vitest'
import { normalizePowerShellCommand } from './powerShellCommand'

describe('PowerShell lexical chain normalization', () => {
  it.each([
    'Write-Output "A&&B"',
    "Write-Output 'A&&B'",
    'Write-Output "A`"&&B"',
    "Write-Output 'A''&&B'",
    'Write-Output A`&`&B',
    'Write-Output “A&&B”',
    'Write-Output "$(Write-Output \'A&&B\')"',
    "node -e 'console.log(1 && 2)'",
    'Write-Output @"\nA&&B\n"@',
    "Write-Output @'\nA&&B\n'@",
    'Write-Output 1 # A&&B',
    'Write-Output 1 <# A&&B #>',
    'Write-Output "npm create vite && text"',
    "${A&&B} = 'literal'; Write-Output ${A&&B}",
    'node --% -e "console.log(1 && 2)"',
  ])('preserves literal/script text: %s', (command) => {
    expect(normalizePowerShellCommand(command)).toBe(command)
  })

  it('rewrites only actual operators and is idempotent through both consumers', () => {
    const result = normalizePowerShellCommand('Write-Output "A&&B" && Write-Output \'C&&D\' && Write-Output End')
    expect(result).toContain('Write-Output "A&&B"; if ($?) { Write-Output \'C&&D\'; if ($?) { Write-Output End')
    expect(normalizePowerShellCommand(result)).toBe(result)
  })

  it.each([';', '\n'])('closes a chain at the statement boundary %j', (separator) => {
    const result = normalizePowerShellCommand(`Write-Error Failed && Write-Output Forbidden${separator}Write-Output Independent`)
    expect(result).toContain(` }${separator}Write-Output Independent`)
  })

  it('closes a chain before a trailing comment and at its enclosing script block', () => {
    const result = normalizePowerShellCommand('& { Write-Output A && Write-Output B # literal&&\n }; Write-Output C')
    expect(result).toContain(' }# literal&&')
    expect(normalizePowerShellCommand(result)).toBe(result)
  })
})
