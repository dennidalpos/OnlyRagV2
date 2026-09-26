import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectStructuredCommand } from './structuredCommandSafety'

// Host-native paths: the resolver uses node:path, so a literal C:\ is only absolute on Windows.
const hostRoot = path.parse(process.cwd()).root

describe('inspectStructuredCommand', () => {
  const workspace = path.join(hostRoot, 'workspace')

  it('keeps a quoted separator inside a command argument', () => {
    expect(inspectStructuredCommand("Write-Output 'a;b'", workspace)).toEqual({ allowed: true, requiresApproval: false })
  })

  it('rejects dynamic invocation and paths outside the workspace', () => {
    expect(inspectStructuredCommand('Invoke-Expression $command', workspace)).toMatchObject({ allowed: false })
    expect(inspectStructuredCommand(`Remove-Item -Recurse -Force ${hostRoot}`, workspace)).toMatchObject({ allowed: false })
  })

  it('requires approval for a confined file mutation and destructive git action', () => {
    expect(inspectStructuredCommand('Set-Content -Path src\\state.txt -Value ready', workspace)).toEqual({ allowed: true, requiresApproval: true })
    expect(inspectStructuredCommand('git reset --hard HEAD', workspace)).toMatchObject({ allowed: false, requiresApproval: false })
  })
})

describe('inspectStructuredCommand: what coding work needs and what it must not do', () => {
  const workspace = path.join(hostRoot, 'workspace')
  const allowed = (command: string) => inspectStructuredCommand(command, workspace)

  it('accepts the chaining, redirections and environment syntax models write for builds', () => {
    expect(allowed('npm install && npm run build')).toEqual({ allowed: true, requiresApproval: false })
    expect(allowed('npm run build 2>&1')).toEqual({ allowed: true, requiresApproval: false })
    expect(allowed('npm test *> $null')).toEqual({ allowed: true, requiresApproval: false })
    expect(allowed('$env:CI="true"; npm test')).toEqual({ allowed: true, requiresApproval: false })
    expect(allowed('cd src; npm run lint')).toEqual({ allowed: true, requiresApproval: false })
    expect(allowed('git commit -m ">fix: quoted text is not a redirect"')).toEqual({ allowed: true, requiresApproval: false })
  })

  it('treats output redirected into a workspace file as a file write, and refuses one outside it', () => {
    expect(allowed('npm run build > build.log')).toEqual({ allowed: true, requiresApproval: true })
    expect(allowed(`Write-Output x > ${path.join(hostRoot, 'elsewhere', 'x.txt')}`)).toMatchObject({ allowed: false })
    expect(allowed('Write-Output x >> ..\\outside.txt')).toMatchObject({ allowed: false })
  })

  it('confines deletion aliases and location changes to the workspace', () => {
    expect(allowed('ri -Recurse ..\\sibling')).toMatchObject({ allowed: false })
    expect(allowed('rd dist')).toEqual({ allowed: true, requiresApproval: true })
    expect(allowed('cd ..')).toMatchObject({ allowed: false })
    expect(allowed(`Set-Location ${hostRoot}`)).toMatchObject({ allowed: false })
  })

  it('resolves relative paths where the shell stands, not at the workspace root', () => {
    const src = path.join(workspace, 'src')
    const fromSrc = (command: string) => inspectStructuredCommand(command, workspace, src)

    // The persistent shell keeps a `cd`: from src/ the parent is the root, still inside.
    expect(fromSrc('cd ..')).toEqual({ allowed: true, requiresApproval: false })
    expect(fromSrc('cd ..\\..')).toMatchObject({ allowed: false })
    expect(fromSrc('Remove-Item ..\\dist -Recurse')).toEqual({ allowed: true, requiresApproval: true })
    expect(fromSrc('Remove-Item ..\\..\\sibling -Recurse')).toMatchObject({ allowed: false })
    // A cd inside the command moves the base for the segments after it.
    expect(allowed('cd src; Remove-Item ..\\..\\sibling')).toMatchObject({ allowed: false })
    expect(allowed('cd src\\components; Remove-Item ..\\old.ts')).toEqual({ allowed: true, requiresApproval: true })
    // A reported directory outside the workspace is not trusted: paths resolve at the root again.
    expect(inspectStructuredCommand('cd ..', workspace, hostRoot)).toMatchObject({ allowed: false })
  })

  it('asks before inline code and refuses git operations aimed outside the workspace or at history', () => {
    expect(allowed("node -e \"require('fs').rmSync('x')\"")).toEqual({ allowed: true, requiresApproval: true })
    expect(allowed('cmd /c del /s *.js')).toEqual({ allowed: true, requiresApproval: true })
    expect(allowed(`git -C ${path.join(hostRoot, 'other')} status`)).toMatchObject({ allowed: false })
    expect(allowed('git -C . reset --hard')).toMatchObject({ allowed: false })
    expect(allowed('git checkout .')).toMatchObject({ allowed: false })
    expect(allowed('git push origin +main')).toMatchObject({ allowed: false })
  })

  it('still refuses dynamic code and says why', () => {
    const result = allowed('$x = "rm"; & $x file')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeTruthy()
    expect(allowed('npm test || echo failed')).toMatchObject({ allowed: false, reason: expect.stringContaining('||') })
  })
})
