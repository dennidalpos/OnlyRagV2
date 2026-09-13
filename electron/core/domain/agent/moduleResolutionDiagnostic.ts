

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

/** Decides which of the two causes the output describes. */
export function classifyModuleDiagnostic(
  output: string,
  isPackageInstalled: (pkg: string) => boolean
): ModuleDiagnosticCause {
  const packages = unresolvedPackages(output)
  if (packages.length === 0) return 'none'
  if (!packages.every((pkg) => isPackageInstalled(pkg))) return 'missing_dependency'
  return 'compiler_resolution'
}

/** One instruction: fix the config that cannot see `node_modules`. */
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
