/**
 * Project Verification Resolver.
 *
 * Answers one question: "which commands does THIS project already provide to prove it is
 * healthy?" — and it answers it by reading the project's own manifest, never by asking the
 * model to invent a command.
 *
 * That distinction is the point. In session-1787485700613-o3tx the plan carried three
 * verification milestones the model had written itself ("Run `npm run build`", "Run
 * `tsc --noEmit`"); none of them ever ran, the session finished COMPLETED, and the project it
 * shipped had no `src/main.tsx` at all. A small model is not a reliable source of build
 * commands. The manifest is.
 *
 * Pure domain: the caller supplies the manifest contents through a `WorkspaceManifestReader`,
 * so this module never touches `fs` and the resolution rules stay directly testable.
 */

/** What the caller must be able to tell us about the workspace. */
export interface WorkspaceManifest {
  /** Parsed package.json, or null when absent/unparseable. */
  packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null
  /** Relative paths that exist in the workspace root (only the ones probed below are needed). */
  hasFile: (relativePath: string) => boolean
}

export type VerificationKind = 'build' | 'typecheck' | 'test' | 'lint'

export interface VerificationCommand {
  kind: VerificationKind
  command: string
  /** Why this command was chosen — surfaced to the model so a failure is actionable. */
  source: string
}

/**
 * Script names that mean each kind, in preference order. Read from the manifest rather than
 * assumed: a project that does not declare the script simply does not offer that check.
 */
const SCRIPT_CANDIDATES: Record<VerificationKind, string[]> = {
  build: ['build'],
  typecheck: ['typecheck', 'type-check', 'tsc', 'check-types'],
  test: ['test'],
  lint: ['lint'],
}

const WATCH_FLAG = /(^|\s)(--watch|-w)(\s|$)/
const SERVER_WORD = /(^|[\s&|;])(dev|serve|start|preview|watch)([\s&|;]|$)/

/**
 * CLIs that start a long-running server when invoked with no terminating subcommand.
 * `vite` alone IS the dev server — the commonest way a generated project spells it.
 */
const SERVER_CLIS = new Set(['vite', 'nodemon', 'next', 'nuxt', 'parcel', 'webpack-dev-server', 'http-server', 'serve'])
const TERMINATING_SUBCOMMANDS = new Set(['build', 'generate', 'export'])

/**
 * Whether a declared script actually exits.
 *
 * Load-bearing for correctness, not tidiness: a blocked verification is indistinguishable from
 * a passing one until the timeout fires, so a dev server picked as the build check would report
 * a healthy project for as long as it kept running.
 */
export function isTerminatingScript(scriptBody: string): boolean {
  const script = (scriptBody || '').trim()
  if (!script) return false
  if (WATCH_FLAG.test(script) || SERVER_WORD.test(script)) return false

  for (const segment of script.split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/).filter((t) => t && !t.startsWith('-'))
    if (tokens.length === 0) continue
    const offset = tokens[0] === 'npx' || tokens[0] === 'npm' ? 1 : 0
    const cli = tokens[offset]
    if (!cli || !SERVER_CLIS.has(cli)) continue
    if (!TERMINATING_SUBCOMMANDS.has(tokens[offset + 1] ?? '')) return false
  }

  return true
}

/**
 * Resolves the verification commands the workspace offers, strongest first.
 *
 * `build` comes first deliberately: it is the only check that exercises the whole import graph,
 * which is what a missing entrypoint or an undeclared dependency actually breaks.
 */
export function resolveVerificationCommands(manifest: WorkspaceManifest): VerificationCommand[] {
  const commands: VerificationCommand[] = []
  const scripts = manifest.packageJson?.scripts ?? {}

  for (const kind of ['build', 'typecheck', 'test', 'lint'] as VerificationKind[]) {
    for (const name of SCRIPT_CANDIDATES[kind]) {
      const body = scripts[name]
      if (typeof body !== 'string' || !body.trim()) continue
      if (!isTerminatingScript(body)) continue
      commands.push({ kind, command: `npm run ${name}`, source: `package.json script "${name}"` })
      break
    }
  }

  // A TypeScript project without a typecheck script can still be typechecked; the compiler is
  // reachable through the local toolchain without adding anything to the project.
  const hasTypecheck = commands.some((c) => c.kind === 'typecheck')
  if (!hasTypecheck && manifest.hasFile('tsconfig.json')) {
    commands.push({ kind: 'typecheck', command: 'npx tsc --noEmit', source: 'tsconfig.json present, no typecheck script declared' })
  }

  return commands
}

/**
 * The single command that best attests the project still works, or null when the project
 * offers none. Callers that need one gate — the Definition of Done check — use this.
 */
export function resolvePrimaryVerificationCommand(manifest: WorkspaceManifest): VerificationCommand | null {
  return resolveVerificationCommands(manifest)[0] ?? null
}
