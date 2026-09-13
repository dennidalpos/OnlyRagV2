import { describe, expect, it } from 'vitest'
import { inspectStructuredCommand } from './structuredCommandSafety'

describe('inspectStructuredCommand', () => {
  const workspace = 'C:\\workspace'

  it('keeps a quoted separator inside a command argument', () => {
    expect(inspectStructuredCommand("Write-Output 'a;b'", workspace)).toEqual({ allowed: true, requiresApproval: false })
  })

  it('rejects dynamic invocation and paths outside the workspace', () => {
    expect(inspectStructuredCommand('Invoke-Expression $command', workspace)).toMatchObject({ allowed: false })
    expect(inspectStructuredCommand('Remove-Item -Recurse -Force C:\\', workspace)).toMatchObject({ allowed: false })
  })

  it('requires approval for a confined file mutation and destructive git action', () => {
    expect(inspectStructuredCommand('Set-Content -Path src\\state.txt -Value ready', workspace)).toEqual({ allowed: true, requiresApproval: true })
    expect(inspectStructuredCommand('git reset --hard HEAD', workspace)).toEqual({ allowed: true, requiresApproval: true })
  })
})
