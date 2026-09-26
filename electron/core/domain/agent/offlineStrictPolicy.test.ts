import { describe, expect, it } from 'vitest'
import { authorizeOfflineStrict, npxCommandNames, shellCommandHasEgress } from './offlineStrictPolicy'

function request(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-42',
    toolName: 'read_file',
    capability: 'filesystem',
    operation: 'read',
    mode: 'offline-strict',
    workspaceRoot: 'D:/projects/demo',
    consent: { requested: false, granted: false },
    ...overrides,
  } as never
}

describe('offline-strict capability policy', () => {
  it('allows local filesystem and Git inspection', () => {
    expect(authorizeOfflineStrict(request()).allowed).toBe(true)
    expect(authorizeOfflineStrict(request({ capability: 'git', operation: 'read', toolName: 'git_status' })).allowed).toBe(true)
  })

  it('blocks HTTP/download and browser capabilities', () => {
    expect(
      authorizeOfflineStrict(request({ capability: 'http-download', operation: 'connect', toolName: 'web_search', target: 'https://example.test' })),
    ).toMatchObject({
      allowed: false,
      reason: 'Network egress is disabled in offline-strict mode',
    })
    expect(authorizeOfflineStrict(request({ capability: 'browser', operation: 'open', toolName: 'open_in_browser' })).allowed).toBe(false)
  })

  it('blocks network-capable shell commands but allows local commands', () => {
    expect(shellCommandHasEgress('Invoke-WebRequest https://example.test')).toBe(true)
    expect(shellCommandHasEgress('npm run typecheck')).toBe(false)
    expect(
      authorizeOfflineStrict(request({ capability: 'shell', operation: 'execute', toolName: 'run_command', target: 'git pull origin main' })).allowed,
    ).toBe(false)
    expect(authorizeOfflineStrict(request({ capability: 'shell', operation: 'execute', toolName: 'run_command', target: 'npm run test' })).allowed).toBe(true)
  })

  it('blocks Git network operations and rejects unimplemented policy modes', () => {
    expect(authorizeOfflineStrict(request({ capability: 'git', operation: 'connect', toolName: 'git_remote' })).allowed).toBe(false)
    expect(authorizeOfflineStrict(request({ mode: 'local-only' })).allowed).toBe(false)
    expect(authorizeOfflineStrict(request({ capability: 'filesystem', operation: 'write', toolName: 'write_file' })).auditId).toContain('policy-session-42')
  })
})

describe('package manager egress detection', () => {
  it('recognises the install forms models actually write', () => {
    for (const command of [
      'npm i',
      'npm ci',
      'npm install --no-audit --no-fund',
      'pnpm add zod',
      'yarn',
      'pip install requests',
      'python -m pip install -r requirements.txt',
      'iwr https://x',
      'git submodule update --init',
      'cargo add serde',
      'go get example.com/x',
    ]) {
      expect(shellCommandHasEgress(command), command).toBe(true)
    }
  })

  it('leaves local builds and tests alone', () => {
    for (const command of ['npm run build', 'npm test', 'npx vitest run', 'npx tsc --noEmit', 'python -m pytest', 'git status']) {
      expect(shellCommandHasEgress(command, ['vitest', 'tsc']), command).toBe(false)
    }
  })

  it('treats npx of a command the workspace does not provide as a download', () => {
    // npx installs a missing package without asking, and the shell adds -y: without this check a
    // bare `npx cowsay` reached the registry with no consent even in offline-strict mode.
    expect(shellCommandHasEgress('npx tsc --noEmit')).toBe(true)
    expect(shellCommandHasEgress('npx create-vite@latest . --template react', ['vite'])).toBe(true)
    expect(shellCommandHasEgress('npm run build; npx -y cowsay hi', ['tsc'])).toBe(true)
    expect(shellCommandHasEgress('pnpm dlx create-next-app')).toBe(true)
    expect(shellCommandHasEgress('bunx prettier .')).toBe(true)
    expect(shellCommandHasEgress('npx --no-install eslint .')).toBe(false)
  })
})

describe('npxCommandNames', () => {
  it('names the command npx runs in every segment, without versions', () => {
    expect(npxCommandNames('npx -y create-vite@latest app')).toEqual(['create-vite'])
    expect(npxCommandNames('npx @angular/cli@17 new app')).toEqual(['@angular/cli'])
    expect(npxCommandNames('npx -p typescript tsc --noEmit')).toEqual(['typescript', 'tsc'])
    expect(npxCommandNames('npx --package=prettier@3 prettier .')).toEqual(['prettier', 'prettier'])
    expect(npxCommandNames('npm run build && npx vitest run')).toEqual(['vitest'])
    expect(npxCommandNames('npx.cmd eslint .')).toEqual(['eslint'])
  })

  it('ignores npx runs that cannot download and commands that are not npx', () => {
    expect(npxCommandNames('npx --no eslint .')).toEqual([])
    expect(npxCommandNames('npx --offline vitest')).toEqual([])
    expect(npxCommandNames('npm test')).toEqual([])
    expect(npxCommandNames('echo npx vitest')).toEqual([])
  })
})
