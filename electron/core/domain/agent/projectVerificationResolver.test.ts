import { describe, it, expect } from 'vitest'
import {
  isTerminatingScript,
  resolvePrimaryVerificationCommand,
  resolveVerificationCommands,
  type WorkspaceManifest,
} from './projectVerificationResolver'

function manifest(
  scripts: Record<string, string> | null,
  files: string[] = []
): WorkspaceManifest {
  return {
    packageJson: scripts === null ? null : { scripts },
    hasFile: (p) => files.includes(p),
  }
}

describe('resolveVerificationCommands', () => {
  it('offers nothing for a workspace with no manifest and no tsconfig', () => {
    expect(resolveVerificationCommands(manifest(null))).toEqual([])
    expect(resolvePrimaryVerificationCommand(manifest(null))).toBeNull()
  })

  it('puts build first: it is the only check that exercises the whole import graph', () => {
    const commands = resolveVerificationCommands(
      manifest({ lint: 'eslint .', test: 'vitest run', build: 'tsc && vite build' })
    )
    expect(commands.map((c) => c.kind)).toEqual(['build', 'test', 'lint'])
    expect(resolvePrimaryVerificationCommand(manifest({ build: 'vite build' }))?.command).toBe('npm run build')
  })

  it('accepts the alternative spellings a generated project actually uses for typecheck', () => {
    for (const name of ['typecheck', 'type-check', 'tsc', 'check-types']) {
      const commands = resolveVerificationCommands(manifest({ [name]: 'tsc --noEmit' }))
      expect(commands).toEqual([{ kind: 'typecheck', command: `npm run ${name}`, source: `package.json script "${name}"` }])
    }
  })

  it('falls back to the compiler when a TypeScript project declares no typecheck script', () => {
    const commands = resolveVerificationCommands(manifest({ build: 'vite build' }, ['tsconfig.json']))
    expect(commands.map((c) => c.command)).toEqual(['npm run build', 'npx tsc --noEmit'])
  })

  it('prefers the declared typecheck script over the compiler fallback', () => {
    const commands = resolveVerificationCommands(manifest({ typecheck: 'tsc --noEmit' }, ['tsconfig.json']))
    expect(commands.map((c) => c.command)).toEqual(['npm run typecheck'])
  })

  it('ignores a script whose body is empty or whitespace', () => {
    expect(resolveVerificationCommands(manifest({ build: '   ' }))).toEqual([])
  })

  it('never proposes a script that does not terminate', () => {
    // A blocked verification is indistinguishable from a passing one until the timeout fires,
    // so a dev server must never be picked as proof that the project builds.
    const commands = resolveVerificationCommands(
      manifest({ build: 'vite dev', test: 'vitest --watch', lint: 'eslint .' })
    )
    expect(commands.map((c) => c.kind)).toEqual(['lint'])
  })
})

describe('isTerminatingScript', () => {
  it('accepts one-shot build and test commands', () => {
    expect(isTerminatingScript('tsc && vite build')).toBe(true)
    expect(isTerminatingScript('vitest run')).toBe(true)
    expect(isTerminatingScript('tsc --noEmit')).toBe(true)
    expect(isTerminatingScript('eslint . --max-warnings 0')).toBe(true)
    expect(isTerminatingScript('jest --ci')).toBe(true)
  })

  it('rejects long-running servers and watchers', () => {
    expect(isTerminatingScript('vite')).toBe(false)
    expect(isTerminatingScript('vite preview')).toBe(false)
    expect(isTerminatingScript('next dev')).toBe(false)
    expect(isTerminatingScript('nodemon index.js')).toBe(false)
    expect(isTerminatingScript('tsc --watch')).toBe(false)
    expect(isTerminatingScript('vitest --watch')).toBe(false)
    expect(isTerminatingScript('node server.js && npm start')).toBe(false)
  })
})
