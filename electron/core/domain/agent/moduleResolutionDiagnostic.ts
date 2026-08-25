/**
 * Module Resolution Diagnostic.
 *
 * `Cannot find module 'react-router-dom'` has two completely different causes, and until now
 * this agent read every one of them as the same thing.
 *
 * Measured on 2026-08-25, runs 6 and 7 of the `fullTask` probe, identical both times: the
 * `tsconfig.json` the model writes carries `"module": "ESNext"` and no `moduleResolution`, so
 * TypeScript falls back to `classic`, which never looks inside `node_modules`. `tsc` then
 * reports `TS2792 Cannot find module` for packages that are **installed and present on disk**.
 * The missing-dependency branch fires, the agent installs them again, and the same error comes
 * back: run 7 spent five `npm install @mui/material` and four `npm install react-router-dom
 * @mui/material` on packages that were already there, and closed at 0/14.
 *
 * The two cases are distinguishable without heuristics, because the answer is on disk: if the
 * package is in `node_modules`, the dependency is not missing and installing it again cannot
 * change anything. The compiler even names the remedy itself — `TS2792` prints "Did you mean to
 * set the 'moduleResolution' option" — and the fix is an edit to `tsconfig.json`, not an install.
 *
 * One value is named, not two. The first draft offered `"bundler"` with `"node"` as a fallback
 * "if the project targets CommonJS", and run 12 of 2026-08-25 shows why that was wrong twice
 * over: a directive that offers a choice invites the model to make the wrong one (§5.3), and the
 * fallback itself became invalid — `node`/`node10` was removed in TypeScript 7, which is exactly
 * where `dependencyVersionReality` now moves projects. The delivered manifest carried
 * `typescript@^7.0.2` and the build died on `TS5108: Option 'moduleResolution=node10' has been
 * removed`. `bundler` is correct for every Vite project this agent builds and valid in both 5
 * and 7.
 *
 * Pure domain: whether a package is installed is injected by the caller.
 */

/** `Cannot find module 'x'` / `Cannot find module "x"`, in tsc and bundler phrasing alike. */
const CANNOT_FIND_MODULE = /cannot find module\s+['"`]([^'"`]+)['"`]/gi

/** TypeScript says this itself when the failure is its own resolution mode. */
const RESOLUTION_HINT = /moduleResolution/i

export type ModuleDiagnosticCause = 'missing_dependency' | 'compiler_resolution' | 'none'

/**
 * The package a specifier belongs to: `react-icons/fa` is provided by `react-icons`, and
 * `@mui/material/Button` by `@mui/material`. Relative imports belong to no package.
 */
export function packageOfSpecifier(specifier: string): string | null {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Every package named by a "cannot find module" line in the output, deduplicated. */
export function unresolvedPackages(output: string): string[] {
  const found = new Set<string>()
  for (const match of (output || '').matchAll(CANNOT_FIND_MODULE)) {
    const pkg = packageOfSpecifier(match[1])
    if (pkg) found.add(pkg)
  }
  return [...found]
}

/**
 * Decides which of the two causes the output describes.
 *
 * `compiler_resolution` requires that **every** package named is already installed: one genuinely
 * absent package makes installing the right next action, and the resolution problem — if there is
 * one — will still be there to diagnose on the next run. Doubt resolves towards installing,
 * because that is the cheap and reversible move.
 */
export function classifyModuleDiagnostic(
  output: string,
  isPackageInstalled: (pkg: string) => boolean
): ModuleDiagnosticCause {
  const packages = unresolvedPackages(output)
  if (packages.length === 0) return 'none'
  if (!packages.every((pkg) => isPackageInstalled(pkg))) return 'missing_dependency'
  return 'compiler_resolution'
}

/**
 * One instruction: fix the config that cannot see `node_modules`.
 *
 * It names the setting and the value rather than saying "configure module resolution", for the
 * same reason `entrypointIntegrity` hands over the exact script tag: an instruction a model has
 * to translate into a concrete edit is one it can get wrong, and this one it had already got
 * wrong twice by reinstalling instead.
 */
export function buildModuleResolutionDirective(output: string, packages: string[]): string {
  const named = packages.slice(0, 4).join(', ')
  const compilerSaidSo = RESOLUTION_HINT.test(output || '')
  return [
    `\n\n[THE PACKAGE IS INSTALLED — THE COMPILER CANNOT SEE IT]`,
    `${named}${packages.length > 4 ? ` and ${packages.length - 4} more` : ''} ${packages.length === 1 ? 'is' : 'are'} already present in node_modules, so this is NOT a missing dependency and installing ${packages.length === 1 ? 'it' : 'them'} again will report exactly the same error.`,
    compilerSaidSo
      ? `The compiler named the cause itself: its "moduleResolution" setting. With "module": "ESNext" and no "moduleResolution", TypeScript falls back to "classic", which never looks inside node_modules.`
      : `The cause is the TypeScript configuration: without a node-aware "moduleResolution", the compiler never looks inside node_modules.`,
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "tsconfig.json", with the complete file, adding "moduleResolution": "bundler" to compilerOptions.`,
    `2. Do NOT run any install command for ${packages.length === 1 ? 'this package' : 'these packages'}. ${packages.length === 1 ? 'It is' : 'They are'} on disk already.`,
  ].join('\n')
}
