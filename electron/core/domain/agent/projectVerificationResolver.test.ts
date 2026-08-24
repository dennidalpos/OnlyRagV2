import { describe, it, expect } from 'vitest'
import {
  coverageOfScript,
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
      expect(commands).toEqual([
        { kind: 'typecheck', command: `npm run ${name}`, coverage: 'whole-project', source: `package.json script "${name}"` },
      ])
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

/**
 * The failure this classification exists for, from the live run of 2026-08-24: `npm run build`
 * (a bare `vite build`) exited 0 reporting `2 modules transformed`, because the project's
 * `index.html` carried no script tag pointing at `src/main.tsx`. Nothing under `src/` was
 * reachable, nothing under `src/` was read — and that pass promoted thirteen milestones,
 * five of them naming files the check never opened.
 */
describe('verification coverage', () => {
  it('treats a bare bundler build as reachable-only', () => {
    expect(coverageOfScript('build', 'vite build')).toBe('entry-reachable')
  })

  it('treats a build that typechecks first as whole-project', () => {
    // Same script name, opposite coverage — which is why this reads the body, not the name.
    expect(coverageOfScript('build', 'tsc && vite build')).toBe('whole-project')
    expect(coverageOfScript('build', 'npx tsc --noEmit && webpack')).toBe('whole-project')
    expect(coverageOfScript('build', 'vue-tsc && vite build')).toBe('whole-project')
  })

  it('does not mistake a word containing tsc for the compiler', () => {
    expect(coverageOfScript('build', 'node scripts/buildtsconfig.js && vite build')).toBe('entry-reachable')
  })

  it('treats typecheck, test and lint as whole-project: their file set comes from config', () => {
    expect(coverageOfScript('typecheck', 'tsc --noEmit')).toBe('whole-project')
    expect(coverageOfScript('test', 'vitest run')).toBe('whole-project')
    expect(coverageOfScript('lint', 'eslint .')).toBe('whole-project')
  })
})

describe('resolvePrimaryVerificationCommand — coverage decides before kind', () => {
  const manifestOf = (scripts: Record<string, string>, files: string[] = []) => ({
    packageJson: { scripts },
    hasFile: (p: string) => files.includes(p),
  })

  it('prefers the typecheck over a build that only follows the entrypoint', () => {
    const primary = resolvePrimaryVerificationCommand(
      manifestOf({ build: 'vite build', typecheck: 'tsc --noEmit' })
    )

    expect(primary?.command).toBe('npm run typecheck')
    expect(primary?.coverage).toBe('whole-project')
  })

  it('keeps the build first when the build itself typechecks the project', () => {
    const primary = resolvePrimaryVerificationCommand(
      manifestOf({ build: 'tsc && vite build', typecheck: 'tsc --noEmit' })
    )

    expect(primary?.command).toBe('npm run build')
  })

  it('falls back to the reachable-only build when the project offers nothing better', () => {
    // A weak check beats none, and it is the one the project itself declares.
    const primary = resolvePrimaryVerificationCommand(manifestOf({ build: 'vite build' }))

    expect(primary?.command).toBe('npm run build')
    expect(primary?.coverage).toBe('entry-reachable')
  })

  it('reaches the compiler through tsconfig when no script declares a typecheck', () => {
    const primary = resolvePrimaryVerificationCommand(
      manifestOf({ build: 'vite build' }, ['tsconfig.json'])
    )

    expect(primary?.command).toBe('npx tsc --noEmit')
    expect(primary?.coverage).toBe('whole-project')
  })

  it('still returns null for a project that declares no check at all', () => {
    expect(resolvePrimaryVerificationCommand(manifestOf({ dev: 'vite' }))).toBeNull()
  })
})
