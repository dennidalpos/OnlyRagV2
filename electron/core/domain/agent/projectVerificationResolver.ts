import { valid as validVersion } from 'semver'

/** Workspace manifest probe interface. */
export interface WorkspaceManifest {
  /** Parsed package.json, or null when absent/unparseable. */
  packageJson: {
    packageManager?: unknown
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  } | null
  /** Relative paths that exist in the workspace root. */
  hasFile: (relativePath: string) => boolean
  /** Bounded text probe for native test configuration; absent probes cannot invent commands. */
  readTextFile?: (relativePath: string) => string | null
}

export type VerificationKind = 'build' | 'typecheck' | 'test' | 'lint'

/** Scope of verification coverage. */
export type VerificationCoverage = 'whole-project' | 'entry-reachable'

export interface VerificationCommand {
  kind: VerificationKind
  command: string
  coverage: VerificationCoverage
  /** Rationale for command selection. */
  source: string
}

/** Candidate script names per verification kind in preference order. */
const SCRIPT_CANDIDATES: Record<VerificationKind, string[]> = {
  build: ['build'],
  typecheck: ['typecheck', 'type-check', 'tsc', 'check-types'],
  test: ['test'],
  lint: ['lint'],
}

const WATCH_FLAG = /(^|\s)(--watch|-w)(\s|$)/
const SERVER_WORD = /(^|[\s&|;])(dev|serve|start|preview|watch)([\s&|;]|$)/

/** CLIs that run long-running servers without terminating subcommands. */
const SERVER_CLIS = new Set(['vite', 'nodemon', 'next', 'nuxt', 'parcel', 'webpack-dev-server', 'http-server', 'serve'])
const TERMINATING_SUBCOMMANDS = new Set(['build', 'generate', 'export'])

/** Whole-project typecheck CLIs. */
const WHOLE_PROJECT_CHECKERS = /(^|[\s&|;/\\])(tsc|vue-tsc|svelte-check|astro\s+check)([\s&|;]|$)/

/** Ambiguous manager facts cannot authorize a guessed script runner. */
export function resolvePackageManager(manifest: WorkspaceManifest): 'npm' | 'pnpm' | 'yarn' | null {
  const locks = new Set<'npm' | 'pnpm' | 'yarn'>()
  if (manifest.hasFile('package-lock.json') || manifest.hasFile('npm-shrinkwrap.json')) locks.add('npm')
  if (manifest.hasFile('pnpm-lock.yaml')) locks.add('pnpm')
  if (manifest.hasFile('yarn.lock')) locks.add('yarn')
  if (locks.size > 1) return null
  const declared = manifest.packageJson?.packageManager
  if (declared !== undefined) {
    if (typeof declared !== 'string') return null
    const match = /^(npm|pnpm|yarn)@(.+)$/.exec(declared)
    if (!match || !validVersion(match[2])) return null
    const manager = match[1] as 'npm' | 'pnpm' | 'yarn'
    return locks.size && !locks.has(manager) ? null : manager
  }
  return locks.values().next().value ?? 'npm'
}

/** Evaluates verification coverage of a script. */
export function coverageOfScript(kind: VerificationKind, scriptBody: string): VerificationCoverage {
  if (kind === 'test') return 'entry-reachable'
  if (kind !== 'build') return 'whole-project'
  return WHOLE_PROJECT_CHECKERS.test(scriptBody || '') ? 'whole-project' : 'entry-reachable'
}

/** Whether a declared script actually exits. */
export function isTerminatingScript(scriptBody: string): boolean {
  const script = (scriptBody || '').trim()
  if (!script) return false
  if (WATCH_FLAG.test(script) || SERVER_WORD.test(script)) return false

  for (const segment of script.split(/&&|\|\||;/)) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .filter((t) => t && !t.startsWith('-'))
    if (tokens.length === 0) continue
    const offset = tokens[0] === 'npx' || tokens[0] === 'npm' ? 1 : 0
    const cli = tokens[offset]
    if (!cli || !SERVER_CLIS.has(cli)) continue
    if (!TERMINATING_SUBCOMMANDS.has(tokens[offset + 1] ?? '')) return false
  }

  return true
}

/** Resolves the verification commands the workspace offers, strongest first. */
export function resolveVerificationCommands(manifest: WorkspaceManifest): VerificationCommand[] {
  const commands: VerificationCommand[] = []
  const scripts = manifest.packageJson?.scripts ?? {}
  const manager = resolvePackageManager(manifest)

  for (const kind of ['build', 'typecheck', 'test', 'lint'] as VerificationKind[]) {
    for (const name of SCRIPT_CANDIDATES[kind]) {
      if (!manager) break
      const body = scripts[name]
      if (typeof body !== 'string' || !body.trim()) continue
      if (!isTerminatingScript(body)) continue
      commands.push({
        kind,
        command: `${manager} run ${name}`,
        coverage: coverageOfScript(kind, body),
        source: `package.json script "${name}"`,
      })
      break
    }
  }

  // Fall back to the installed compiler before lint can become the primary check.
  const hasTypecheck = commands.some((c) => c.kind === 'typecheck')
  if (!hasTypecheck && manifest.hasFile('tsconfig.json') && manifest.hasFile('node_modules/typescript/bin/tsc')) {
    const lintIndex = commands.findIndex((command) => command.kind === 'lint')
    commands.splice(lintIndex < 0 ? commands.length : lintIndex, 0, {
      kind: 'typecheck',
      command: 'node node_modules/typescript/bin/tsc --noEmit',
      coverage: 'whole-project',
      source: 'tsconfig.json and installed TypeScript compiler, no typecheck script declared',
    })
  }

  commands.push(...resolveNativeVerificationCommands(manifest))
  return commands
}

/** Native checks use observed manifests and installed tools, never a Node fallback or bootstrap wrapper. */
function resolveNativeVerificationCommands(manifest: WorkspaceManifest): VerificationCommand[] {
  const commands: VerificationCommand[] = []
  const add = (kind: VerificationKind, command: string, source: string) =>
    commands.push({ kind, command, coverage: kind === 'test' ? 'entry-reachable' : 'whole-project', source: `native: ${source}` })
  const text = (name: string) => manifest.readTextFile?.(name) ?? ''
  const pythonConfig =
    ['pytest.ini', '.pytest.ini'].find((name) => manifest.hasFile(name)) ||
    (['pyproject.toml', 'setup.cfg', 'tox.ini'] as const).find((name) => {
      const section = { 'pyproject.toml': 'tool\\.pytest(?:\\.ini_options)?', 'setup.cfg': 'tool:pytest', 'tox.ini': 'pytest' }[name]
      return manifest.hasFile(name) && new RegExp(`^\\s*\\[${section}\\]\\s*(?:[#;].*)?$`, 'm').test(text(name))
    })
  if (pythonConfig) {
    const python = manifest.hasFile('.venv/Scripts/python.exe') ? '.\\.venv\\Scripts\\python.exe' : 'python'
    add('test', `${python} -B -m pytest -q -p no:cacheprovider`, pythonConfig)
  }
  if (manifest.hasFile('go.mod')) add('test', 'go test -mod=readonly -count=1 -timeout=30s ./...', 'go.mod')
  if (manifest.hasFile('Cargo.toml')) add('test', `cargo test --offline${manifest.hasFile('Cargo.lock') ? ' --locked' : ''}`, 'Cargo.toml')
  if (manifest.hasFile('pom.xml')) add('build', 'mvn --offline --batch-mode -DfailIfNoTests=true verify', 'pom.xml')
  const gradleManifest = ['build.gradle', 'build.gradle.kts'].find((name) => manifest.hasFile(name))
  if (gradleManifest) add('build', 'gradle --offline --no-daemon --console=plain check', gradleManifest)
  if (manifest.hasFile('composer.json')) {
    try {
      const composer = JSON.parse(text('composer.json'))
      const scripts: unknown[] = Array.isArray(composer?.scripts?.test) ? composer.scripts.test : [composer?.scripts?.test]
      if (scripts.length > 0 && scripts.every((script) => typeof script === 'string' && isTerminatingScript(script) && !/\bphp\s+-S\b/.test(script))) {
        add('test', 'composer --no-interaction --no-plugins run-script test', 'composer.json script "test"')
      }
    } catch {
      /* An unreadable manifest is not evidence of an available command. */
    }
  }
  return commands
}

/** Picks the strongest check: the first whole-project command, else the first one offered. */
export function pickPrimaryVerification<T extends Pick<VerificationCommand, 'coverage'>>(commands: readonly T[]): T | null {
  return commands.find((c) => c.coverage === 'whole-project') ?? commands[0] ?? null
}
