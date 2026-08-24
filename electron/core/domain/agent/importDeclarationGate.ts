/**
 * Import Declaration Gate.
 *
 * Answers one question about a single file, the moment it is written: "does every package this
 * file imports actually exist in the project?"
 *
 * The project already has a dependency check — see dependencyIntegrityGate.ts — but it scans
 * the whole workspace with depcheck and runs inside the finish gate, so it only speaks when
 * the model calls `finish`. A session that never gets there never hears it. In
 * coding_agent_audit.log session-1787562597025-q8a5 the model wrote three components importing
 * `@tailwindcss/react`, `tailwind-react-components` and `@tailwindcss/components` — none of
 * which exist on npm — at steps 11, 13 and 17. The session died on the loop guard at step 45
 * without the gate ever running, and the three invented packages are still on disk.
 *
 * This gate is the cheap, immediate half: it parses only the file just written, so it costs
 * one AST walk the write already performs for syntax validation, and it can answer at step 11
 * instead of never.
 *
 * Deliberately narrow. It reports a specifier only when it is certain: a bare package name,
 * absent from the manifest, not a Node builtin, not covered by a tsconfig path alias. Anything
 * it cannot resolve confidently is left alone, because a false accusation sends a small model
 * rewriting working imports.
 *
 * Pure domain: the caller supplies the file's text, the declared package names and the alias
 * prefixes. Nothing here touches disk.
 */

import ts from 'typescript'
import { builtinModules } from 'node:module'

/** What the caller must be able to tell us about the project's declarations. */
export interface DeclaredPackages {
  /** Every name in dependencies / devDependencies / peerDependencies / optionalDependencies. */
  names: ReadonlySet<string>
  /**
   * Bare prefixes that resolve through tsconfig `compilerOptions.paths` or a bundler alias
   * (`@/`, `~/`, `@app/`). A specifier starting with one of these is a local path in disguise.
   */
  aliasPrefixes?: readonly string[]
}

export interface ImportIntegrityVerdict {
  ok: boolean
  /** Bare specifiers this file imports that the project does not declare, sorted, deduplicated. */
  undeclared: string[]
  /** Present only when `ok` is false: what the model must do, in the loop's directive format. */
  directive?: string
}

/** Extensions whose imports this gate understands. Anything else returns no specifiers. */
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

/**
 * Node's own modules, which are always resolvable and never belong in package.json.
 * Read from the runtime rather than listed here so the set tracks the Node version in use.
 */
const NODE_BUILTINS: ReadonlySet<string> = new Set(builtinModules)

function extensionOf(filePath: string): string {
  const match = /\.[^.\\/]+$/.exec(filePath || '')
  return match ? match[0].toLowerCase() : ''
}

/**
 * The package a specifier belongs to: `react-dom/client` -> `react-dom`,
 * `@scope/pkg/sub/path` -> `@scope/pkg`.
 */
export function packageNameOfSpecifier(specifier: string): string {
  const segments = specifier.split('/')
  return specifier.startsWith('@') && segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0]
}

/**
 * True for a specifier that names a package rather than a file: not relative, not absolute,
 * not a Node builtin, not a subpath import (`#internal`), not a URL.
 */
function isBareSpecifier(specifier: string): boolean {
  if (!specifier) return false
  // Relative, absolute, or a package-internal subpath import.
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) return false
  // Any protocol form — `node:fs`, `bun:test`, `https://…`, `data:` — resolves outside the manifest.
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return false
  return !NODE_BUILTINS.has(packageNameOfSpecifier(specifier))
}

/**
 * Every bare module specifier the file imports, verbatim, in first-seen order and deduplicated.
 *
 * Verbatim rather than reduced to package names, because the alias check downstream has to see
 * the specifier the author wrote: `~/services/api` reduces to the package name `~`, which
 * matches no alias prefix and would be reported as a missing package.
 *
 * Covers `import`, `import type`, `export ... from`, `import()` and `require()` — a model
 * writing CommonJS is as capable of inventing a package as one writing ESM. Type-only imports
 * are included on purpose: a missing `@types` package still fails a typecheck.
 */
export function extractBareImportSpecifiers(filePath: string, content: string): string[] {
  if (!SCANNABLE_EXTENSIONS.has(extensionOf(filePath))) return []
  if (!content || !content.trim()) return []

  const ext = extensionOf(filePath)
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ext === '.tsx' || ext === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

  const found: string[] = []
  const seen = new Set<string>()

  const record = (raw: string | undefined) => {
    if (!raw || !isBareSpecifier(raw)) return
    if (seen.has(raw)) return
    seen.add(raw)
    found.push(raw)
  }

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) record(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression
      if (ts.isStringLiteral(expr)) record(expr.text)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      const firstArg = node.arguments[0]
      if ((isDynamicImport || isRequire) && firstArg && ts.isStringLiteral(firstArg)) record(firstArg.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

/**
 * Judges one written file against the project's declarations.
 *
 * Returns `ok` for anything it cannot decide — an unscannable extension, an empty manifest,
 * a specifier behind an alias prefix — because the cost of a wrong accusation (a model
 * rewriting imports that worked) is higher than the cost of deferring to the build.
 */
export function evaluateFileImportIntegrity(
  filePath: string,
  content: string,
  declared: DeclaredPackages
): ImportIntegrityVerdict {
  const specifiers = extractBareImportSpecifiers(filePath, content)
  if (specifiers.length === 0) return { ok: true, undeclared: [] }

  // No manifest, or one with nothing declared at all: the project is too early for this check
  // to mean anything, and every import would be reported.
  if (declared.names.size === 0) return { ok: true, undeclared: [] }

  // Alias prefixes are matched against the specifier as written; package names are resolved
  // only afterwards, since `~/services/api` reduces to `~` and would match no prefix.
  const aliasPrefixes = declared.aliasPrefixes || []
  const undeclared = Array.from(
    new Set(
      specifiers
        .filter((specifier) => !aliasPrefixes.some((prefix) => prefix && specifier.startsWith(prefix)))
        .map(packageNameOfSpecifier)
        .filter((pkg) => !declared.names.has(pkg))
    )
  ).sort()

  if (undeclared.length === 0) return { ok: true, undeclared: [] }

  const list = undeclared.map((pkg, index) => `${index + 1}. "${pkg}"`).join('\n')
  return {
    ok: false,
    undeclared,
    directive:
      `[UNDECLARED IMPORT IN ${filePath}]\n` +
      `The file was written, but it imports ${undeclared.length} package${undeclared.length === 1 ? '' : 's'} that package.json does not declare:\n` +
      `${list}\n` +
      `This file cannot compile as it stands. Directives:\n` +
      `1. If the package is real and you meant to use it, install it with run_command (e.g. "npm install <package>") so package.json declares it.\n` +
      `2. If you are not certain the package exists, rewrite the file using only what the project already declares. Inventing a plausible-looking package name is the most common cause of this message.\n` +
      `3. Do not leave the import in place and move on. The next build will fail on this file.`,
  }
}
