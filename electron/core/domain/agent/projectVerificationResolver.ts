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

/**
 * How much of the project a check actually looks at.
 *
 * The distinction is not academic; it was measured. In the live run of 2026-08-24 `npm run
 * build` (a bare `vite build`) exited 0 having reported `2 modules transformed`, because the
 * project's `index.html` carried no `<script>` tag pointing at `src/main.tsx`. Nothing under
 * `src/` was reachable from the entry, so nothing under `src/` was compiled — and that pass
 * promoted thirteen milestones plan-wide, five of them naming files the check never opened.
 *
 * `milestoneVerificationPromotion.ts` rests on a stated premise: a green build "compiled the
 * files that are on disk right now, so it attests to all of them at once". That premise holds
 * only for a `whole-project` check.
 */
export type VerificationCoverage =
  /** Reads every source file the project declares, reachable from the entry or not. */
  | 'whole-project'
  /** Follows the import graph from an entrypoint; anything unreferenced is never examined. */
  | 'entry-reachable'

export interface VerificationCommand {
  kind: VerificationKind
  command: string
  coverage: VerificationCoverage
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
 * Typecheckers that read the project's own file set rather than an import graph.
 *
 * A `build` script is only as thorough as what it runs: `tsc && vite build` reads every file
 * `tsconfig.json` includes before the bundler ever starts, while a bare `vite build` reads only
 * what the entry references. Same script name, opposite coverage — which is why this is
 * decided from the script BODY and not from its name.
 */
const WHOLE_PROJECT_CHECKERS = /(^|[\s&|;/\\])(tsc|vue-tsc|svelte-check|astro\s+check)([\s&|;]|$)/

/**
 * How much of the project a declared script actually examines.
 *
 * Only a bundler build is treated as entry-reachable. A typecheck, a test run and a lint all
 * take their file set from configuration, so an unreferenced file is still read.
 */
export function coverageOfScript(kind: VerificationKind, scriptBody: string): VerificationCoverage {
  if (kind !== 'build') return 'whole-project'
  return WHOLE_PROJECT_CHECKERS.test(scriptBody || '') ? 'whole-project' : 'entry-reachable'
}

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
      commands.push({
        kind,
        command: `npm run ${name}`,
        coverage: coverageOfScript(kind, body),
        source: `package.json script "${name}"`,
      })
      break
    }
  }

  // A TypeScript project without a typecheck script can still be typechecked; the compiler is
  // reachable through the local toolchain without adding anything to the project.
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

/**
 * The single command that best attests the project still works, or null when the project
 * offers none. Callers that need one gate — the Definition of Done check — use this.
 *
 * Coverage decides before kind. `build` used to win outright, on the reasoning that it is the
 * only check exercising the whole import graph — true, and beside the point when the import
 * graph is empty. A bundler build of a project whose entry references nothing passes in
 * milliseconds having read nothing, and that pass is then read as proof for every file on disk.
 * A check that takes its file set from configuration cannot pass that way.
 *
 * An entry-reachable build is still returned when the project offers nothing better: a weak
 * check is worth more than none, and it is the one the project itself declares.
 */
export function resolvePrimaryVerificationCommand(manifest: WorkspaceManifest): VerificationCommand | null {
  const commands = resolveVerificationCommands(manifest)
  return commands.find((c) => c.coverage === 'whole-project') ?? commands[0] ?? null
}
