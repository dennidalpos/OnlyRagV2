import { describe, it, expect } from 'vitest'
import {
  coverageOfScript,
  isTerminatingScript,
  pickPrimaryVerification,
  resolveVerificationCommands,
  resolvePackageManager,
  type WorkspaceManifest,
} from './projectVerificationResolver'

function manifest(scripts: Record<string, string> | null, files: string[] = []): WorkspaceManifest {
  return {
    packageJson: scripts === null ? null : { scripts },
    hasFile: (p) => files.includes(p),
  }
}

const primaryOf = (m: WorkspaceManifest) => pickPrimaryVerification(resolveVerificationCommands(m))

describe('resolveVerificationCommands', () => {
  it('selects native tools from observed manifests without npm fallback', () => {
    const workspace = manifest(null, ['go.mod', 'Cargo.toml', 'Cargo.lock', 'pom.xml', 'build.gradle.kts'])
    expect(resolveVerificationCommands(workspace).map((item) => item.command)).toEqual([
      'go test -mod=readonly -count=1 -timeout=30s ./...',
      'cargo test --offline --locked',
      'mvn --offline --batch-mode -DfailIfNoTests=true verify',
      'gradle --offline --no-daemon --console=plain check',
    ])
  })

  it('requires Python test configuration and an explicit Composer test script', () => {
    const workspace = manifest(null, ['pyproject.toml', 'requirements.txt', 'composer.json'])
    workspace.readTextFile = (name) => (name === 'composer.json' ? '{"scripts":{"test":"php tests/verify.php"}}' : '[project]\nname = "demo"')
    expect(resolveVerificationCommands(workspace).map((item) => item.command)).toEqual(['composer --no-interaction --no-plugins run-script test'])
    workspace.readTextFile = (name) =>
      name === 'pyproject.toml' ? '[tool.pytest.ini_options]\ntestpaths = ["tests"]' : '{"scripts":{"test":"php -S localhost:8080"}}'
    expect(resolveVerificationCommands(workspace).map((item) => item.command)).toEqual(['python -B -m pytest -q -p no:cacheprovider'])
  })

  it('uses a project virtual environment and refuses malformed Composer configuration', () => {
    const workspace = manifest(null, ['pytest.ini', '.venv/Scripts/python.exe', 'composer.json'])
    workspace.readTextFile = () => '{bad json'
    expect(resolveVerificationCommands(workspace).map((item) => item.command)).toEqual(['.\\.venv\\Scripts\\python.exe -B -m pytest -q -p no:cacheprovider'])
  })

  it.each(['pyproject.toml', 'setup.cfg', 'tox.ini'])("does not treat another format's pytest section as configuration in %s", (name) => {
    const workspace = manifest(null, [name])
    workspace.readTextFile = () => (name === 'pyproject.toml' ? '[pytest]\n' : '[tool.pytest.ini_options]\n')
    expect(resolveVerificationCommands(workspace)).toEqual([])
  })
  it.each(['npm', 'pnpm', 'yarn'])('uses an explicit %s declaration for existing scripts', (manager) => {
    const workspace = manifest({ test: 'node verify.cjs' })
    workspace.packageJson!.packageManager = `${manager}@1.2.3`
    expect(resolveVerificationCommands(workspace)[0].command).toBe(`${manager} run test`)
  })

  it.each([
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
  ])('uses the unique %s manager fact', (lockfile, manager) => {
    expect(resolveVerificationCommands(manifest({ build: 'node verify.cjs' }, [lockfile]))[0].command).toBe(`${manager} run build`)
  })

  it.each(['bun@1.2.3', 'pnpm; touch file', 'pnpm', 'yarn@latest', '', 42])('refuses unsupported or malformed manager declaration %s', (value) => {
    const workspace = manifest({ test: 'node verify.cjs' })
    workspace.packageJson!.packageManager = value
    expect(resolvePackageManager(workspace)).toBeNull()
    expect(resolveVerificationCommands(workspace)).toEqual([])
  })

  it('refuses conflicting facts but preserves a direct installed compiler fallback', () => {
    const workspace = manifest({ test: 'node verify.cjs' }, ['pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json', 'node_modules/typescript/bin/tsc'])
    expect(resolvePackageManager(workspace)).toBeNull()
    expect(resolveVerificationCommands(workspace).map((item) => item.command)).toEqual(['node node_modules/typescript/bin/tsc --noEmit'])
    const contradictory = manifest({ test: 'node verify.cjs' }, ['package-lock.json'])
    contradictory.packageJson!.packageManager = 'pnpm@1.2.3'
    expect(resolveVerificationCommands(contradictory)).toEqual([])
  })
  it('offers nothing for a workspace with no manifest and no tsconfig', () => {
    expect(resolveVerificationCommands(manifest(null))).toEqual([])
    expect(primaryOf(manifest(null))).toBeNull()
  })

  it('puts build first: it is the only check that exercises the whole import graph', () => {
    const commands = resolveVerificationCommands(manifest({ lint: 'eslint .', test: 'vitest run', build: 'tsc && vite build' }))
    expect(commands.map((c) => c.kind)).toEqual(['build', 'test', 'lint'])
    expect(primaryOf(manifest({ build: 'vite build' }))?.command).toBe('npm run build')
  })

  it('accepts the alternative spellings a generated project actually uses for typecheck', () => {
    for (const name of ['typecheck', 'type-check', 'tsc', 'check-types']) {
      const commands = resolveVerificationCommands(manifest({ [name]: 'tsc --noEmit' }))
      expect(commands).toEqual([{ kind: 'typecheck', command: `npm run ${name}`, coverage: 'whole-project', source: `package.json script "${name}"` }])
    }
  })

  it('falls back to the compiler when a TypeScript project declares no typecheck script', () => {
    const commands = resolveVerificationCommands(manifest({ build: 'vite build' }, ['tsconfig.json', 'node_modules/typescript/bin/tsc']))
    expect(commands.map((c) => c.command)).toEqual(['npm run build', 'node node_modules/typescript/bin/tsc --noEmit'])
  })

  it('chooses an installed TypeScript compiler before a whole-project lint script', () => {
    const primary = primaryOf(manifest({ build: 'vite build', lint: 'eslint .' }, ['tsconfig.json', 'node_modules/typescript/bin/tsc']))
    expect(primary?.kind).toBe('typecheck')
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
    const commands = resolveVerificationCommands(manifest({ build: 'vite dev', test: 'vitest --watch', lint: 'eslint .' }))
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

/** The failure this classification exists for, from the live run of 2026-08-24: `npm run build` (a bare `vite build`) exited 0 reporting `2 modules transformed`, because the project's `index.html` carried no script tag pointing at `src/main.tsx`. */
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

  it('treats typecheck and lint as whole-project: their file set comes from config', () => {
    expect(coverageOfScript('typecheck', 'tsc --noEmit')).toBe('whole-project')
    expect(coverageOfScript('lint', 'eslint .')).toBe('whole-project')
  })

  it('treats a test run as entry-reachable: it examines only what the test files import', () => {
    expect(coverageOfScript('test', 'vitest run')).toBe('entry-reachable')
  })
})

describe('pickPrimaryVerification — coverage decides before kind', () => {
  const manifestOf = (scripts: Record<string, string>, files: string[] = []) => ({
    packageJson: { scripts },
    hasFile: (p: string) => files.includes(p),
  })

  it('prefers the typecheck over a build that only follows the entrypoint', () => {
    const primary = primaryOf(manifestOf({ build: 'vite build', typecheck: 'tsc --noEmit' }))

    expect(primary?.command).toBe('npm run typecheck')
    expect(primary?.coverage).toBe('whole-project')
  })

  it('keeps the build first when the build itself typechecks the project', () => {
    const primary = primaryOf(manifestOf({ build: 'tsc && vite build', typecheck: 'tsc --noEmit' }))

    expect(primary?.command).toBe('npm run build')
  })

  it('falls back to the reachable-only build when the project offers nothing better', () => {
    // A weak check beats none, and it is the one the project itself declares.
    const primary = primaryOf(manifestOf({ build: 'vite build' }))

    expect(primary?.command).toBe('npm run build')
    expect(primary?.coverage).toBe('entry-reachable')
  })

  it('reaches the compiler through tsconfig when no script declares a typecheck', () => {
    const primary = primaryOf(manifestOf({ build: 'vite build' }, ['tsconfig.json', 'node_modules/typescript/bin/tsc']))

    expect(primary?.command).toBe('node node_modules/typescript/bin/tsc --noEmit')
    expect(primary?.coverage).toBe('whole-project')
  })

  it('keeps the build ahead of the test script, which cannot prove the project builds', () => {
    expect(primaryOf(manifestOf({ build: 'vite build', test: 'vitest run' }))?.command).toBe('npm run build')
    expect(primaryOf(manifestOf({ test: 'vitest run' }))?.command).toBe('npm run test')
  })

  it('still returns null for a project that declares no check at all', () => {
    expect(primaryOf(manifestOf({ dev: 'vite' }))).toBeNull()
  })
})
