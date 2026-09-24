import ts from 'typescript'
import { builtinModules } from 'node:module'
import { scriptKindForPath } from './sourceScriptKind'

/** Declared project packages and import path aliases. */
export interface DeclaredPackages {
  /** Declared dependency package names. */
  names: ReadonlySet<string>
  /** Specifier path alias prefixes (e.g. `@/`, `~/`). */
  aliasPrefixes?: readonly string[]
}

export interface ImportIntegrityVerdict {
  ok: boolean
  /** Bare specifiers this file imports that the project does not declare. */
  undeclared: string[]
  /** Present only when `ok` is false: corrective directive for the agent. */
  directive?: string
}

/** Supported file extensions for import scanning. */
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

/** Built-in Node modules that do not require declaration in package.json. */
const NODE_BUILTINS: ReadonlySet<string> = new Set(builtinModules)

function extensionOf(filePath: string): string {
  const match = /\.[^.\\/]+$/.exec(filePath || '')
  return match ? match[0].toLowerCase() : ''
}

/** Extracts package name from specifier (handles scopes and subpaths). */
export function packageNameOfSpecifier(specifier: string): string {
  const segments = specifier.split('/')
  return specifier.startsWith('@') && segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0]
}

/** Checks if specifier is a non-builtin bare package. */
function isBareSpecifier(specifier: string): boolean {
  if (!specifier) return false
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return false
  return !NODE_BUILTINS.has(packageNameOfSpecifier(specifier))
}

/** Extracts deduplicated bare import specifiers in AST order. */
export function extractBareImportSpecifiers(filePath: string, content: string): string[] {
  if (!SCANNABLE_EXTENSIONS.has(extensionOf(filePath))) return []
  if (!content || !content.trim()) return []

  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKindForPath(filePath))

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

/** Package import statement and its bound names. */
export interface PackageImportStatement {
  statement: string
  boundNames: string[]
}

/** Extracts import/require statements referencing a specific package. */
export function extractPackageImportStatements(filePath: string, content: string, packageName: string): PackageImportStatement[] {
  if (!SCANNABLE_EXTENSIONS.has(extensionOf(filePath)) || !content?.trim()) return []
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKindForPath(filePath))
  const belongs = (specifier: string) => isBareSpecifier(specifier) && packageNameOfSpecifier(specifier) === packageName
  const found: PackageImportStatement[] = []

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && belongs(statement.moduleSpecifier.text)) {
      const clause = statement.importClause
      const names: string[] = []
      if (clause?.name) names.push(clause.name.text)
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text)
        else for (const element of clause.namedBindings.elements) names.push(element.name.text)
      }
      found.push({ statement: statement.getText(sourceFile), boundNames: names })
      continue
    }
    if (ts.isVariableStatement(statement)) {
      const requires = statement.declarationList.declarations.filter((d) => {
        const init = d.initializer
        return (
          init &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          init.expression.text === 'require' &&
          init.arguments[0] &&
          ts.isStringLiteral(init.arguments[0]) &&
          belongs(init.arguments[0].text)
        )
      })
      if (requires.length === 0) continue
      const names = requires.flatMap((d) =>
        ts.isIdentifier(d.name) ? [d.name.text] : ts.isObjectBindingPattern(d.name) ? d.name.elements.map((e) => e.name.getText(sourceFile)) : [],
      )
      found.push({ statement: statement.getText(sourceFile), boundNames: names })
    }
  }
  return found
}

/** Evaluates file import integrity against declared packages. */
export function evaluateFileImportIntegrity(filePath: string, content: string, declared: DeclaredPackages): ImportIntegrityVerdict {
  const specifiers = extractBareImportSpecifiers(filePath, content)
  if (specifiers.length === 0) return { ok: true, undeclared: [] }

  // Skip if project has no declared packages yet
  if (declared.names.size === 0) return { ok: true, undeclared: [] }

  // Filter alias prefixes before resolving package names
  const aliasPrefixes = declared.aliasPrefixes || []
  const undeclared = Array.from(
    new Set(
      specifiers
        .filter((specifier) => !aliasPrefixes.some((prefix) => prefix && specifier.startsWith(prefix)))
        .map(packageNameOfSpecifier)
        .filter((pkg) => !declared.names.has(pkg)),
    ),
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
