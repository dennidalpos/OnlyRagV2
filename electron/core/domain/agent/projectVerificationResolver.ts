/** Workspace manifest probe interface. */
export interface WorkspaceManifest {
  /** Parsed package.json, or null when absent/unparseable. */
  packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null
  /** Relative paths that exist in the workspace root. */
  hasFile: (relativePath: string) => boolean
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

  for (const kind of ['build', 'typecheck', 'test', 'lint'] as VerificationKind[]) {
    for (const name of SCRIPT_CANDIDATES[kind]) {
      const body = scripts[name]
      if (typeof body !== 'string' || !body.trim()) continue
      if (!isTerminatingScript(body)) continue
      commands.push({
        kind,
        command: `npm run ${name}`,
        coverage: coverageOfScript(kind, body),
        source: `package.json script "${name}"`,
      })
      break
    }
  }

  // Fall back to tsc --noEmit when tsconfig exists but no typecheck script is declared
  const hasTypecheck = commands.some((c) => c.kind === 'typecheck')
  if (!hasTypecheck && manifest.hasFile('tsconfig.json')) {
    commands.push({
      kind: 'typecheck',
      command: 'npx tsc --noEmit',
      coverage: 'whole-project',
      source: 'tsconfig.json present, no typecheck script declared',
    })
  }

  return commands
}

/** Resolves primary verification command (prefers whole-project). */
export function resolvePrimaryVerificationCommand(manifest: WorkspaceManifest): VerificationCommand | null {
  const commands = resolveVerificationCommands(manifest)
  return commands.find((c) => c.coverage === 'whole-project') ?? commands[0] ?? null
}
