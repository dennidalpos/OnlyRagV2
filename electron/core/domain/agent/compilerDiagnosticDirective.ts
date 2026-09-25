import type { SupportedToolName } from './agentTypes'
import { buildBrowserGlobalDirective, buildTestFailureDirective, domEnvironmentFor, extractFailingTest, testedModuleText } from './testFailureDiagnostic'

const ANSI_SEQUENCE = /\u001b\[[0-9;]*m/g

export interface CompilerDiagnostic {
  file: string
  line: number
  column?: number
  /** Compiler error code when the format carries one (`TS2304`, `E0433`); absent otherwise. */
  code?: string
  message: string
}

/** The command the compiler suggested, when it suggested one, normalised to `npm install`. */
export function extractSuggestedCommand(output: string): string | null {
  for (const raw of (output || '').split(/\r?\n/)) {
    const match = SUGGESTED_COMMAND_PATTERN.exec(raw)
    if (!match) continue
    const command = match[1].trim()
    if (!/^(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\b/i.test(command)) continue
    return command.replace(/^npm\s+i\b/i, 'npm install')
  }
  return null
}

/** Matches TypeScript compiler errors: file(line,col): error TS... */
const TSC_PATTERN = /^\s*(\S+?)\((\d+),(\d+)\):\s*error\s+([A-Z]+\d+):\s*(.+)$/

/** Matches colon-separated compiler errors: file:line:col: error ... */
const COLON_PATTERN = /^\s*(\S+?):(\d+):(\d+):\s*(?:error|ERROR)\s*:?\s*(.+)$/

/** Maximum diagnostics reported to avoid prompt bloat. */
const MAX_REPORTED = 5

/** Compiler remedy command pattern. */
const SUGGESTED_COMMAND_PATTERN = /\bTry\s+`([^`]+)`/

/** Parses and deduplicates compiler diagnostics by file+line. */
export function parseCompilerDiagnostics(output: string): CompilerDiagnostic[] {
  if (!output) return []
  const found: CompilerDiagnostic[] = []
  const seen = new Set<string>()

  for (const raw of output.split(/\r?\n/)) {
    const tsc = TSC_PATTERN.exec(raw)
    const colon = tsc ? null : COLON_PATTERN.exec(raw)
    if (!tsc && !colon) continue

    const diagnostic: CompilerDiagnostic = tsc
      ? { file: tsc[1], line: Number(tsc[2]), column: Number(tsc[3]), code: tsc[4], message: tsc[5].trim() }
      : { file: colon![1], line: Number(colon![2]), column: Number(colon![3]), message: colon![4].trim() }

    const key = `${diagnostic.file}:${diagnostic.line}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push(diagnostic)
  }

  return found
}

/** Module resolution error pattern cleared by config or install. */
const MODULE_DIAGNOSTIC = /cannot find module|could not find a declaration file|failed to resolve import/i

/** Matches node_modules paths. */
const IN_DEPENDENCY = /(^|[\\/])node_modules[\\/]/i

/** TypeScript suggested replacement import. */
const SUGGESTED_IMPORT_PATTERN = /\bDid you mean to use '([^']+)' instead\?/
const IMPORT_SPECIFIER_PATTERN = /\bfrom\s+["']([^"']+)["']/

/** TypeScript codes for import/export mismatch. */
const EXPORT_MISMATCH_CODES = new Set(['TS2613', 'TS2614'])

export interface ExportMismatch {
  diagnostic: CompilerDiagnostic
  /** Compiler replacement line. */
  suggestedImport: string
  /** Imported module specifier. */
  moduleSpecifier: string
}

function findExportMismatch(diagnostics: CompilerDiagnostic[]): ExportMismatch | null {
  for (const diagnostic of diagnostics) {
    if (!diagnostic.code || !EXPORT_MISMATCH_CODES.has(diagnostic.code)) continue
    const match = SUGGESTED_IMPORT_PATTERN.exec(diagnostic.message)
    if (!match) continue
    const suggestedImport = match[1].trim()
    const specifier = IMPORT_SPECIFIER_PATTERN.exec(suggestedImport)?.[1]?.trim()
    if (!specifier) continue
    return { diagnostic, suggestedImport, moduleSpecifier: specifier }
  }
  return null
}

/** Extracts the first export/import mismatch with compiler replacement line. */
export function extractExportMismatch(output: string): ExportMismatch | null {
  return findExportMismatch(parseCompilerDiagnostics(output).filter((d) => !IN_DEPENDENCY.test(d.file)))
}

/** Formats secondary compiler diagnostics as a deferred advisory note. */
export function buildDeferredDiagnosticNote(output: string): string | null {
  const codeErrors = parseCompilerDiagnostics(output).filter((d) => !MODULE_DIAGNOSTIC.test(d.message) && !IN_DEPENDENCY.test(d.file))
  if (codeErrors.length === 0) return null

  const shown = codeErrors.slice(0, MAX_REPORTED)
  const overflow = codeErrors.length - shown.length
  return [
    `\n\n[ALSO REPORTED, AFTER THE DIRECTIVE ABOVE]`,
    `The same output carries ${codeErrors.length} error${codeErrors.length === 1 ? '' : 's'} the directive above does NOT fix. Do not act on ${codeErrors.length === 1 ? 'it' : 'them'} in this step — carry out the directive first; ${codeErrors.length === 1 ? 'it' : 'they'} will still be reported afterwards, and then the file to edit is named here:`,
    ...shown.map((d) => `- ${d.file} line ${d.line}${d.code ? ` (${d.code})` : ''}: ${d.message}`),
    overflow > 0 ? `- and ${overflow} more` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Missing relative import target to be created. */
export interface MissingRelativeModule {
  diagnostic: CompilerDiagnostic
  specifier: string
  expectedPath: string
}

const RELATIVE_MODULE_MISSING = /cannot find module\s+'(\.[^']*)'/i

/** Resolves relative import path using the importer's extension. */
export function resolveRelativeImportPath(importingFile: string, specifier: string): string {
  const normalised = importingFile.replace(/\\/g, '/')
  const dir = normalised.split('/').slice(0, -1)
  const out = [...dir]
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const joined = out.join('/')
  if (/\.[A-Za-z0-9]+$/.test(joined)) return joined
  const ext = normalised.match(/(\.[A-Za-z0-9]+)$/)
  return ext ? joined + ext[1] : joined
}

/** The first diagnostic whose failure is a relative import pointing at a file that is not there. */
export function extractMissingRelativeModule(output: string): MissingRelativeModule | null {
  for (const diagnostic of parseCompilerDiagnostics(output).filter((d) => !IN_DEPENDENCY.test(d.file))) {
    if (diagnostic.code && diagnostic.code !== 'TS2307') continue
    const match = RELATIVE_MODULE_MISSING.exec(diagnostic.message)
    if (!match) continue
    return {
      diagnostic,
      specifier: match[1],
      expectedPath: resolveRelativeImportPath(diagnostic.file, match[1]),
    }
  }
  return null
}

/** A name imported from a package the package does not export. */
export interface MissingExportMember {
  diagnostic: CompilerDiagnostic
  /** The package the import names, e.g. `@headlessui/react`. */
  packageName: string
  /** The member that is not there, e.g. `Card`. */
  memberName: string
}

interface MissingLocalExportMember {
  diagnostic: CompilerDiagnostic
  specifier: string
  memberName: string
}

const MISSING_EXPORT_MEMBER = /module\s+'"?([^'"]+)"?'\s+has no exported member\s+'([^']+)'/i

/** The first import of a name a PACKAGE does not export. */
export function extractMissingExportMember(output: string): MissingExportMember | null {
  for (const diagnostic of parseCompilerDiagnostics(output).filter((d) => !IN_DEPENDENCY.test(d.file))) {
    if (diagnostic.code && diagnostic.code !== 'TS2305') continue
    const match = MISSING_EXPORT_MEMBER.exec(diagnostic.message)
    if (!match) continue
    const packageName = match[1].trim()
    if (!packageName || packageName.startsWith('.') || packageName.startsWith('/')) continue
    return { diagnostic, packageName, memberName: match[2] }
  }
  return null
}

function extractMissingLocalExportMember(output: string): MissingLocalExportMember | null {
  for (const diagnostic of parseCompilerDiagnostics(output).filter((d) => !IN_DEPENDENCY.test(d.file))) {
    if (diagnostic.code && diagnostic.code !== 'TS2305') continue
    const match = MISSING_EXPORT_MEMBER.exec(diagnostic.message)
    if (!match) continue
    const specifier = match[1].trim()
    if (!specifier.startsWith('.')) continue
    return { diagnostic, specifier, memberName: match[2] }
  }
  return null
}

/** Pattern indicating bundler refused JSX in plain JS file. */
const JSX_DISABLED =
  /JSX syntax is disabled|JSX syntax extension is not currently enabled|Unexpected JSX expression|name the file with the \.jsx or \.tsx extension/i
/** Script file path reference pattern (.js/.mjs/.cjs). */
const SCRIPT_FILE_REFERENCE = /([^\s\[\]()'"`]+\.(?:js|mjs|cjs))(?![\w])(?::(\d+))?/g

export interface JsxInScriptFile {
  file: string
  line?: number
  renamedFile: string
}

/** Extracts JSX in .js files requiring rename to .jsx. */
export function extractJsxInScriptFile(output: string): JsxInScriptFile | null {
  if (!output || !JSX_DISABLED.test(output)) return null
  for (const match of output.matchAll(SCRIPT_FILE_REFERENCE)) {
    const file = match[1].replace(/\\/g, '/')
    if (IN_DEPENDENCY.test(file) || /^(?:file|https?):/i.test(file)) continue
    return { file, line: match[2] ? Number(match[2]) : undefined, renamedFile: file.replace(/\.[mc]?js$/i, '.jsx') }
  }
  return null
}

/** Injected workspace probes to keep domain pure. */
export interface DiagnosticWorkspaceFacts {
  packageHasStyleEntry?: (packageName: string) => boolean
  toWorkspaceRelative?: (filePath: string) => string
  fileExists?: (workspaceRelativePath: string) => boolean
  binaryInstalled?: (name: string) => boolean
  readWorkspaceFile?: (workspaceRelativePath: string) => string | null
  readLocalModuleSource?: (importingFile: string, specifier: string) => string | null
}

export interface MissingScriptProgram {
  script: string
  body: string
  program: string
}

/** Shell missing program pattern (cmd.exe and POSIX). */
const PROGRAM_NOT_FOUND: RegExp[] = [
  /^['"]?([\w@./-]+?)['"]? (?:is not recognized as an internal or external command|non [^\s]{1,3} riconosciuto come comando interno o esterno)/m,
  /^(?:sh|bash|zsh)(?:: line \d+)?: (?:\d+: )?([\w@./-]+): (?:command )?not found/m,
]
/** npm script execution echo pattern. */
const NPM_SCRIPT_ECHO = /^> \S+@\S+ ([\w:-]+)\r?\n> (.+)$/m
const VITE_REPLACEABLE = new Set(['react-scripts', 'webpack', 'webpack-cli', 'parcel'])
const PROGRAM_PACKAGES: Record<string, string> = { tsc: 'typescript', 'webpack-cli': 'webpack-cli', vite: 'vite', 'react-scripts': 'react-scripts' }

/** Extracts an npm script whose program is not installed on PATH. */
export function extractMissingScriptProgram(output: string): MissingScriptProgram | null {
  const text = (output || '').replace(ANSI_SEQUENCE, '')
  const echo = NPM_SCRIPT_ECHO.exec(text)
  if (!echo) return null
  for (const pattern of PROGRAM_NOT_FOUND) {
    const program = pattern.exec(text)?.[1]
    if (program && echo[2].trim().split(/\s+/)[0] === program) return { script: echo[1], body: echo[2].trim(), program }
  }
  return null
}

function viteScriptFor(script: string): string {
  return /^(?:dev|start|serve)$/.test(script) ? 'vite' : script === 'preview' ? 'vite preview' : 'vite build'
}

function buildMissingScriptProgramDirective(missing: MissingScriptProgram, facts: DiagnosticWorkspaceFacts): string {
  const header = [
    `[THE SCRIPT'S PROGRAM IS NOT INSTALLED — "${missing.program}"]`,
    `"npm run ${missing.script}" runs "${missing.body}", but no installed package provides the "${missing.program}" command. Rewriting source files cannot fix this.`,
    'Directives:',
  ]
  if (VITE_REPLACEABLE.has(missing.program) && facts.binaryInstalled?.('vite')) {
    return [
      ...header,
      `1. Your next tool call MUST be "write_file" on "package.json": the same complete file with the "${missing.script}" script changed to exactly "${viteScriptFor(missing.script)}". Vite is installed and this project is laid out for it; keep every other line.`,
      `2. Then run "npm run ${missing.script}" again.`,
    ].join('\n')
  }
  return [
    ...header,
    `1. Your next tool call MUST be "run_command" with the command: npm install --save-dev ${PROGRAM_PACKAGES[missing.program] ?? missing.program}`,
    `2. Then run "npm run ${missing.script}" again.`,
  ].join('\n')
}

export interface UnresolvedBundlerImport {
  /** Workspace-relative file holding the import. */
  importer: string
  /** The relative specifier as written, e.g. `./tailwind.css`. */
  specifier: string
}

/** Rolldown (Vite 8) and Vite's import analysis, which report a relative import without a tsc code. */
const BUNDLER_UNRESOLVED: RegExp[] = [
  /Could not resolve ['"](\.{1,2}\/[^'"]+)['"] in (\S+?)(?::\d+(?::\d+)?)?\s*$/m,
  /Failed to resolve import ["'](\.{1,2}\/[^"']+)["'] from ["']([^"']+)["']/,
  /Cannot find module ['"](\.{1,2}\/[^'"]+)['"] imported from [^\r\n]+\r?\n\s*❯\s+(\S+\.[cm]?[jt]sx?):\d+:\d+/,
]
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i
const STYLESHEET = /\.(?:css|pcss|scss|sass|less)$/i

/**
 * Rollup prints `"x" is not exported by "a.jsx", imported by "b.jsx".`; Rolldown (Vite 8) prints
 * `[MISSING_EXPORT] "x" is not exported by "a.jsx".` and names the importer only in the code frame
 * below (`[ src/main.jsx:3:8 ]`). No compiler line carries it, so without this the build failure
 * reached the model as a generic directive and qwen2.5-coder:7b re-read the file for 28 steps
 * (live full task run 30, 2026-09-25).
 */
const BUNDLER_MISSING_EXPORT = /"([^"]+)" is not exported by "([^"]+)"(?:, imported by "([^"]+)")?/
const CODE_FRAME_FILE = /\[\s*([^\s\]]+?):\d+:\d+\s*\]/

export interface BundlerMissingExport {
  /** The imported name; `default` for a default import. */
  name: string
  /** Workspace path of the module that lacks the export. */
  exporter: string
  importer: string | null
}

export function extractBundlerMissingExport(output: string): BundlerMissingExport | null {
  const text = (output || '').replace(ANSI_SEQUENCE, '')
  const match = BUNDLER_MISSING_EXPORT.exec(text)
  if (!match || IN_DEPENDENCY.test(match[2])) return null
  const frame = match[3] ? null : CODE_FRAME_FILE.exec(text.slice(match.index + match[0].length))
  return { name: match[1], exporter: match[2].replace(/\\/g, '/'), importer: match[3] ?? frame?.[1] ?? null }
}

function buildBundlerMissingExportDirective(missing: BundlerMissingExport, exportedNames: string[]): string {
  const { name, exporter, importer } = missing
  const named = exportedNames.filter((n) => n !== 'default')
  const baseName =
    exporter
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? ''
  // The component a default import means: the file's own name, or its only named export.
  const defaultCandidate = named.find((n) => n === baseName) ?? (named.length === 1 ? named[0] : null)
  const fix =
    name === 'default'
      ? defaultCandidate
        ? `the same complete file with "export default ${defaultCandidate}" added as its last line`
        : 'the same complete file with a default export of the component it defines'
      : named.length > 0
        ? `the same complete file, also exporting "${name}" (it currently exports: ${named.slice(0, 24).join(', ')})`
        : `the same complete file, also exporting "${name}"`
  return [
    `[${importer ? `"${importer}"` : 'A MODULE'} IMPORTS "${name}" FROM "${exporter}", WHICH DOES NOT EXPORT IT]`,
    `The bundler stopped at this import. ${name === 'default' ? `"${exporter}" has no default export` : `"${exporter}" has no export named "${name}"`}${named.length > 0 ? `; it exports: ${named.slice(0, 24).join(', ')}` : ''}.`,
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "${exporter}": ${fix}. Keep every other line.`,
    `2. Do NOT re-read "${exporter}" and do NOT re-run the build until that file has changed.`,
  ].join('\n')
}

/**
 * A relative import the bundler could not resolve in a source file. Live full task run 20 of
 * 2026-09-24: `import "./tailwind.css"` in src/App.jsx failed the build five times under the
 * generic auto-healing text while the model kept rewriting src/index.css.
 */
export function extractUnresolvedBundlerImport(output: string): UnresolvedBundlerImport | null {
  const text = (output || '').replace(ANSI_SEQUENCE, '')
  for (const pattern of BUNDLER_UNRESOLVED) {
    const match = pattern.exec(text)
    if (!match) continue
    const importer = match[2].replace(/\\/g, '/').replace(/^\.\//, '')
    // A test file that does not load is testFailureDiagnostic's to explain.
    if (TEST_SOURCE.test(importer) || IN_DEPENDENCY.test(importer)) return null
    return { importer, specifier: match[1] }
  }
  return null
}

/** Nearby specifiers that may be what the import meant: the same file name here, one folder up, or in a styles folder. */
function nearbySpecifiers(specifier: string): string[] {
  const name = specifier.split('/').pop() || ''
  return [`./${name}`, `../${name}`, `./components/${name}`, `./pages/${name}`, `./styles/${name}`, `../styles/${name}`].filter(
    (candidate) => candidate !== specifier,
  )
}

function unresolvedBundlerImportFix(
  unresolved: UnresolvedBundlerImport,
  facts: DiagnosticWorkspaceFacts,
): { kind: 'redirect'; specifier: string } | { kind: 'remove' } | { kind: 'create'; path: string } {
  const exists = facts.fileExists
  const redirect = exists
    ? nearbySpecifiers(unresolved.specifier).find((candidate) => exists(resolveRelativeImportPath(unresolved.importer, candidate)))
    : undefined
  if (redirect) return { kind: 'redirect', specifier: redirect }
  // A stylesheet import binds nothing, so dropping it cannot break the code that follows.
  if (STYLESHEET.test(unresolved.specifier)) return { kind: 'remove' }
  return { kind: 'create', path: resolveRelativeImportPath(unresolved.importer, unresolved.specifier) }
}

function buildUnresolvedBundlerImportDirective(unresolved: UnresolvedBundlerImport, facts: DiagnosticWorkspaceFacts): string {
  const fix = unresolvedBundlerImportFix(unresolved, facts)
  const header = [
    `[THE IMPORTED FILE DOES NOT EXIST — "${unresolved.importer}" imports "${unresolved.specifier}"]`,
    `The bundler resolved "${unresolved.specifier}" from the folder of "${unresolved.importer}" and found nothing there.`,
    'Directives:',
  ]
  if (fix.kind === 'redirect') {
    return [
      ...header,
      `1. Your next tool call MUST be "write_file" on "${unresolved.importer}": the same complete file with "${unresolved.specifier}" changed to "${fix.specifier}", which exists.`,
      '2. Then run the build again.',
    ].join('\n')
  }
  if (fix.kind === 'remove') {
    return [
      ...header,
      `1. Your next tool call MUST be "write_file" on "${unresolved.importer}": the same complete file without the line that imports "${unresolved.specifier}". A stylesheet import binds nothing, so no other line changes; the project's styles are already imported by its entry.`,
      '2. Do NOT edit any other stylesheet for this error. Then run the build again.',
    ].join('\n')
  }
  return [
    ...header,
    `1. Your next tool call MUST be "write_file" on "${fix.path}", creating that file with the exports "${unresolved.importer}" imports from "${unresolved.specifier}".`,
    '2. Then run the build again.',
  ].join('\n')
}

export interface UnresolvedCssImport {
  /** The stylesheet holding the import, as the bundler printed it. */
  file: string
  /** The specifier as written, e.g. `tailwindcss/tailwind.min.css`. */
  specifier: string
  /** The package the specifier points into, or null for a relative one. */
  packageName: string | null
}

const CSS_IMPORT_UNRESOLVED = /Unable to resolve `@import\s+["']([^"']+)["']`/
const CSS_PLUGIN_FILE = /\[plugin (?:vite:css|postcss[\w:-]*)\]\s+(\S+\.(?:css|pcss|postcss|scss|sass|less))\b/
const CSS_FILE_REFERENCE = /([^\s\[\]()'"`]+\.(?:css|pcss|postcss|scss|sass|less))(?![\w])/

function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Extracts an unresolved stylesheet @import. */
export function extractUnresolvedCssImport(output: string): UnresolvedCssImport | null {
  const specifier = CSS_IMPORT_UNRESOLVED.exec(output || '')?.[1]
  if (!specifier) return null
  const file = (CSS_PLUGIN_FILE.exec(output)?.[1] ?? CSS_FILE_REFERENCE.exec(output.slice(output.indexOf(specifier) + specifier.length))?.[1])?.replace(
    /\\/g,
    '/',
  )
  if (!file) return null
  return { file, specifier, packageName: packageNameOf(specifier) }
}

export interface CssSyntaxFailure {
  file: string
  line?: number
  reason?: string
}

const CSS_SYNTAX_ERROR = /CssSyntaxError:\s*(?:\[postcss\]\s*)?(?:(\S+?\.(?:css|pcss|scss|sass|less)):(\d+):\d+:\s*)?(.*)$/m

/** Extracts PostCSS stylesheet parsing failure. */
export function extractCssSyntaxFailure(output: string): CssSyntaxFailure | null {
  const text = (output || '').replace(ANSI_SEQUENCE, '')
  const match = CSS_SYNTAX_ERROR.exec(text)
  if (!match) return null
  const file = (match[1] ?? CSS_PLUGIN_FILE.exec(text)?.[1])?.replace(/\\/g, '/')
  if (!file) return null
  const reason = match[3]?.trim()
  return { file, ...(match[2] ? { line: Number(match[2]) } : {}), ...(reason ? { reason } : {}) }
}

/**
 * postcss-import resolved a CSS `@import` to a package's JavaScript entry and PostCSS choked on it
 * (`node_modules/tailwindcss/lib/index.js:1:1: Unknown word "use strict"`). The stylesheet is valid
 * CSS; its import is not. With Tailwind 3 this is the Tailwind 4 `@import "tailwindcss"` line
 * (live full task runs 33 and 35 of 2026-09-25).
 */
const CSS_IMPORTED_SCRIPT = /node_modules[\\/]((?:@[^\\/\s]+[\\/])?[^\\/\s]+)[\\/]\S*\.[cm]?js:\d+:\d+:\s*Unknown word/

function buildCssImportedScriptDirective(file: string, packageName: string): string {
  const fix =
    packageName === 'tailwindcss'
      ? 'the line @import "tailwindcss"; replaced by these three lines: @tailwind base; @tailwind components; @tailwind utilities; (the Tailwind 3 syntax; @import "tailwindcss" is Tailwind 4 syntax)'
      : `the @import of "${packageName}" removed`
  return [
    `[A CSS @import LOADS JAVASCRIPT — "${file}" IMPORTS THE "${packageName}" PACKAGE]`,
    `PostCSS followed @import "${packageName}" into the package's JavaScript entry and cannot parse it. The rest of "${file}" is not the problem, and the package is installed correctly.`,
    'Directives:',
    `1. Your next tool call MUST be "write_file" on "${file}": the same complete file with ${fix}. Keep every other line.`,
    '2. Then run the build again.',
  ].join('\n')
}

function buildCssSyntaxDirective(failure: CssSyntaxFailure, facts: DiagnosticWorkspaceFacts): string {
  const file = facts.toWorkspaceRelative ? facts.toWorkspaceRelative(failure.file) : failure.file
  const importedPackage = failure.reason ? CSS_IMPORTED_SCRIPT.exec(failure.reason)?.[1]?.replace(/\\/g, '/') : undefined
  if (importedPackage) return buildCssImportedScriptDirective(file, importedPackage)
  return [
    `[STYLESHEET SYNTAX ERROR — "${file}"${failure.line ? ` line ${failure.line}` : ''}]`,
    `PostCSS could not parse "${file}"${failure.reason ? `: ${failure.reason}` : ''}. A stylesheet holds only CSS rules and at-rules; JavaScript, JSX or an import statement written for a script is not CSS.`,
    'Directives:',
    `1. Your next tool call MUST be "write_file" on "${file}": the complete file as valid CSS${failure.line ? `, with line ${failure.line} corrected or removed` : ''}.`,
    '2. Then run the build again.',
  ].join('\n')
}

function buildUnresolvedCssImportDirective(cssImport: UnresolvedCssImport, facts: DiagnosticWorkspaceFacts): string {
  const file = facts.toWorkspaceRelative ? facts.toWorkspaceRelative(cssImport.file) : cssImport.file
  const importLine = `@import "${cssImport.specifier}";`
  const packageEntry = cssImport.packageName && cssImport.packageName !== cssImport.specifier && facts.packageHasStyleEntry?.(cssImport.packageName)
  const fix = packageEntry ? `the line ${importLine} replaced by exactly: @import "${cssImport.packageName}";` : `the line ${importLine} removed`
  return [
    `[CSS @import DOES NOT RESOLVE — "${file}"]`,
    `${importLine} names a file that exists neither in the project nor in node_modules${packageEntry ? `; the installed "${cssImport.packageName}" package declares its own stylesheet entry, imported by its bare name` : ''}. Reinstalling a package cannot create a path the package does not ship.`,
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "${file}": the same complete file with ${fix}. Keep every other line.`,
    `2. Then run the build again.`,
  ].join('\n')
}

/** A failing test whose code read a browser global, when the output reports no compiler error. */
function browserGlobalTest(output: string): ReturnType<typeof extractFailingTest> {
  if (parseCompilerDiagnostics(output).length > 0) return null
  const failing = extractFailingTest(output)
  return failing?.browserGlobal ? failing : null
}

function domEnvironmentInstalled(failing: NonNullable<ReturnType<typeof extractFailingTest>>, facts: DiagnosticWorkspaceFacts): boolean {
  // Unknown counts as installed: the header is the fix either way, and an install is never ordered on a guess.
  return facts.fileExists ? facts.fileExists(`node_modules/${domEnvironmentFor(failing.runner).devPackage}/package.json`) : true
}

/** Tools beyond the file edit that the directive built from this output orders. */
export function diagnosticFixRequiredTools(output: string, facts: DiagnosticWorkspaceFacts = {}): SupportedToolName[] {
  if (extractJsxInScriptFile(output)) return ['move_file']
  const browserTest = browserGlobalTest(output)
  if (browserTest && !domEnvironmentInstalled(browserTest, facts)) return ['run_command']
  const missingProgram = extractMissingScriptProgram(output)
  if (missingProgram && !(VITE_REPLACEABLE.has(missingProgram.program) && facts.binaryInstalled?.('vite'))) return ['run_command']
  return []
}

/** The file the directive built from this output will order written, or null when it orders a command instead. */
export function diagnosticFixTargetFile(output: string, facts: DiagnosticWorkspaceFacts = {}): string | null {
  if (extractSuggestedCommand(output)) return null
  const browserTest = browserGlobalTest(output)
  if (browserTest) return domEnvironmentInstalled(browserTest, facts) ? browserTest.file : null
  if (extractJsxInScriptFile(output)) return null
  const missingProgram = extractMissingScriptProgram(output)
  if (missingProgram) return VITE_REPLACEABLE.has(missingProgram.program) && facts.binaryInstalled?.('vite') ? 'package.json' : null
  const cssImport = extractUnresolvedCssImport(output)
  if (cssImport) return facts.toWorkspaceRelative ? facts.toWorkspaceRelative(cssImport.file) : cssImport.file
  const cssSyntax = extractCssSyntaxFailure(output)
  if (cssSyntax) return facts.toWorkspaceRelative ? facts.toWorkspaceRelative(cssSyntax.file) : cssSyntax.file
  const bundlerImport = extractUnresolvedBundlerImport(output)
  if (bundlerImport) {
    const fix = unresolvedBundlerImportFix(bundlerImport, facts)
    return fix.kind === 'create' ? fix.path : bundlerImport.importer
  }
  const bundlerExport = extractBundlerMissingExport(output)
  if (bundlerExport) return bundlerExport.exporter

  const mismatch = extractExportMismatch(output)
  if (mismatch) {
    return mismatch.moduleSpecifier.startsWith('.') ? resolveRelativeImportPath(mismatch.diagnostic.file, mismatch.moduleSpecifier) : mismatch.diagnostic.file
  }

  const missingRelative = extractMissingRelativeModule(output)
  if (missingRelative) return missingRelative.expectedPath

  const missingExport = extractMissingExportMember(output)
  if (missingExport) return missingExport.diagnostic.file

  const first = parseCompilerDiagnostics(output).filter((d) => !IN_DEPENDENCY.test(d.file))[0]
  return first ? first.file : (extractFailingTest(output)?.file ?? null)
}

export function buildDiagnosticFixDirective(
  output: string,
  /** What a package exports, injected because this module is pure domain and the answer lives in a .d.ts under node_modules. */
  resolvePackageExports: (packageName: string) => string[] = () => [],
  /** Export names from a relative module, injected to keep filesystem access out of domain. */
  resolveLocalModuleExports: (importingFile: string, specifier: string) => string[] = () => [],
  facts: DiagnosticWorkspaceFacts = {},
): string | null {
  const missingProgram = extractMissingScriptProgram(output)
  if (missingProgram) return buildMissingScriptProgramDirective(missingProgram, facts)
  const cssImport = extractUnresolvedCssImport(output)
  if (cssImport) return buildUnresolvedCssImportDirective(cssImport, facts)
  const cssSyntax = extractCssSyntaxFailure(output)
  if (cssSyntax) return buildCssSyntaxDirective(cssSyntax, facts)
  const bundlerImport = extractUnresolvedBundlerImport(output)
  if (bundlerImport) return buildUnresolvedBundlerImportDirective(bundlerImport, facts)
  const bundlerExport = extractBundlerMissingExport(output)
  if (bundlerExport) {
    const exporterFile = bundlerExport.exporter.split('/').pop() ?? bundlerExport.exporter
    return buildBundlerMissingExportDirective(bundlerExport, resolveLocalModuleExports(bundlerExport.exporter, `./${exporterFile}`))
  }

  const jsxInScript = extractJsxInScriptFile(output)
  if (jsxInScript) {
    return [
      `[JSX IN A .js FILE — THIS BUNDLER ONLY PARSES JSX IN .jsx OR .tsx]`,
      `${jsxInScript.file}${jsxInScript.line ? ` line ${jsxInScript.line}` : ''}: the build refused its JSX because the file extension declares plain JavaScript. The content is not the problem, so rewriting it cannot fix this.`,
      `Directives:`,
      `1. Your next tool call MUST be "move_file" with sourcePath "${jsxInScript.file}" and targetPath "${jsxInScript.renamedFile}". Keep the content unchanged.`,
      `2. Imports without an extension (e.g. "./App") resolve to the renamed file. Only if a file imports "${jsxInScript.file.split('/').pop()}" with its extension, rewrite that import line.`,
      `3. Then run the build again.`,
    ].join('\n')
  }

  const all = parseCompilerDiagnostics(output)
  if (all.length === 0) {
    // No compiler error: a test that ran and failed its assertion is the other diagnosable case.
    const failingTest = extractFailingTest(output)
    if (!failingTest) return null
    if (failingTest.browserGlobal) return buildBrowserGlobalDirective(failingTest, domEnvironmentInstalled(failingTest, facts))
    const { readWorkspaceFile, readLocalModuleSource } = facts
    const moduleText =
      failingTest.kind === 'assertion' && readWorkspaceFile && readLocalModuleSource
        ? testedModuleText(failingTest.file, readWorkspaceFile, readLocalModuleSource)
        : null
    return buildTestFailureDirective(failingTest, (importingFile, specifier) => resolveLocalModuleExports(importingFile, specifier).length > 0, moduleText)
  }

  // Errors inside an installed package are never the project's code, and telling the model to rewrite one sends it editing a dependency.
  const diagnostics = all.filter((d) => !IN_DEPENDENCY.test(d.file))
  if (diagnostics.length === 0) {
    const example = all[0]
    return [
      `[THE ERRORS ARE INSIDE AN INSTALLED PACKAGE — YOUR CODE IS NOT THE PROBLEM]`,
      `${all.length} error${all.length === 1 ? '' : 's'}, all of them in node_modules, e.g. ${example.file} line ${example.line}: ${example.message}`,
      `A compiler cannot parse type definitions written for a newer version of itself. This is a toolchain version mismatch, not a defect in any file you wrote.`,
      `Directives:`,
      `1. Your next tool call MUST be "run_command" with: npm install --save-dev typescript@latest`,
      `2. Do NOT edit any file under node_modules, and do NOT rewrite your own source for these errors.`,
    ].join('\n')
  }

  const first = diagnostics[0]

  // The compiler named a remedy.
  const suggested = extractSuggestedCommand(output)
  if (suggested) {
    return [
      `[THE COMPILER NAMED THE FIX, AND IT IS NOT AN EDIT]`,
      `${first.file} line ${first.line}${first.code ? ` (${first.code})` : ''}: ${first.message}`,
      `This is not something you can correct by rewriting the file: the compiler is missing a package, and it printed the command that installs it.`,
      `Directives:`,
      `1. Your next tool call MUST be "run_command" with the command: ${suggested}`,
      `2. Do NOT rewrite "${first.file}" for this error. It will report the same thing until the package is installed.`,
    ].join('\n')
  }
  // The compiler wrote the replacement import itself. This REPLACES the file-and-line directive
  // below rather than being appended to it — blueprint §6.2.2, a message carries one imperative,
  // and two correct directives in one turn is how the previous one got overwritten (see the note
  // on buildDeferredDiagnosticNote). The remaining errors are still listed, without an imperative.
  //
  // It is picked ahead of `diagnostics[0]` when the mismatch is not the first error reported:
  // among the errors on the table this is the one whose fix is already written down, so it is
  // the one where a single write_file is certain to change the outcome. Blueprint §5.6i lists
  // export/import coherence as the standing bottleneck of this model's output.
  const mismatch = findExportMismatch(diagnostics)
  if (mismatch) {
    const target = mismatch.diagnostic
    const remaining = diagnostics.filter((d) => d !== target)
    const restShown = remaining.slice(0, MAX_REPORTED - 1)
    const restOverflow = remaining.length - restShown.length
    const rest = restShown.map((d) => `- ${d.file} line ${d.line}${d.code ? ` (${d.code})` : ''}: ${d.message}`).join('\n')

    const localModule = mismatch.moduleSpecifier.startsWith('.') || mismatch.moduleSpecifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(mismatch.moduleSpecifier)
    if (localModule) {
      const importedTarget = mismatch.moduleSpecifier.startsWith('.')
        ? resolveRelativeImportPath(target.file, mismatch.moduleSpecifier)
        : mismatch.moduleSpecifier
      const localExports = resolveLocalModuleExports(target.file, mismatch.moduleSpecifier)
      if (localExports.includes('default') && /^import\s+[^'{]+\s+from\s+/.test(mismatch.suggestedImport)) {
        return [
          `[THE LOCAL MODULE EXPORT CONTRACT IS AUTHORITATIVE — APPLY THE COMPILER'S IMPORT]`,
          `${target.file}, line ${target.line}${target.column ? `, column ${target.column}` : ''} (${target.code})`,
          `  ${target.message}`,
          `The imported local module "${importedTarget}" exports default, so keep that module unchanged and apply TypeScript's exact compatible import:`,
          `  ${mismatch.suggestedImport}`,
          rest ? `Also reported${restOverflow > 0 ? ` (${restOverflow} more not listed)` : ''}:\n${rest}` : '',
          `Directives:`,
          `1. Your next tool call MUST be "write_file" on "${target.file}", with the complete content of that file, replacing line ${target.line} with exactly: ${mismatch.suggestedImport}`,
          `2. Do NOT edit "${importedTarget}" and do NOT re-run the command until the importer has changed.`,
        ]
          .filter(Boolean)
          .join('\n')
      }
      return [
        `[IMPORT AND EXPORT DISAGREE — PRESERVE THE INTENDED PUBLIC API]`,
        `${target.file}, line ${target.line}${target.column ? `, column ${target.column}` : ''} (${target.code})`,
        `  ${target.message}`,
        `TypeScript printed one mechanically valid fix:`,
        `  ${mismatch.suggestedImport}`,
        `That suggestion proves the two sides disagree; it does not prove which public API the task requires. If the existing export contract in "${importedTarget}" is intended, apply the suggested import in "${target.file}". If the task requires the current import contract, change the export in "${importedTarget}" instead.`,
        rest ? `Also reported${restOverflow > 0 ? ` (${restOverflow} more not listed)` : ''}:\n${rest}` : '',
        `Directives:`,
        `1. Change exactly one side now with "write_file", preserving the task's intended public API; do not change both sides merely to silence the compiler.`,
        `2. Do NOT re-run the command until you have changed a file. It will report exactly these errors again, because nothing will have changed.`,
      ]
        .filter(Boolean)
        .join('\n')
    }

    return [
      `[THE PACKAGE EXPORT CONTRACT IS AUTHORITATIVE — USE THE COMPILER'S IMPORT]`,
      `${target.file}, line ${target.line}${target.column ? `, column ${target.column}` : ''} (${target.code})`,
      `  ${target.message}`,
      `The imported module is an external package, so its export contract is not editable workspace code. TypeScript printed the compatible import:`,
      `  ${mismatch.suggestedImport}`,
      rest ? `Also reported${restOverflow > 0 ? ` (${restOverflow} more not listed)` : ''}:\n${rest}` : '',
      `Directives:`,
      `1. Your next tool call MUST be "write_file" on "${target.file}", with the complete content of that file, in which line ${target.line} is replaced by exactly: ${mismatch.suggestedImport}`,
      `2. Do NOT re-run the command until you have changed a file. It will report exactly these errors again, because nothing will have changed.`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  // Missing relative module requires creating the imported target.
  const missingRelative = extractMissingRelativeModule(output)
  if (missingRelative) {
    const target = missingRelative.diagnostic
    const remaining = diagnostics.filter((d) => d !== target)
    const restShown = remaining.slice(0, MAX_REPORTED - 1)
    const restOverflow = remaining.length - restShown.length
    const rest = restShown.map((d) => `- ${d.file} line ${d.line}${d.code ? ` (${d.code})` : ''}: ${d.message}`).join('\n')

    return [
      `[THE IMPORTED FILE DOES NOT EXIST — CREATE IT]`,
      `${target.file}, line ${target.line}${target.code ? ` (${target.code})` : ''}`,
      `  ${target.message}`,
      `The error is reported on the file that IMPORTS. The file that is missing is the one being imported, and rewriting the importer cannot bring it into existence.`,
      rest ? `Also reported:\n${rest}` : '',
      restOverflow > 0 ? `(and ${restOverflow} more)` : '',
      `Directives:`,
      `1. Your next tool call MUST be "write_file" on "${missingRelative.expectedPath}", creating that file with the exports "${target.file}" imports from "${missingRelative.specifier}".`,
      `2. Do NOT rewrite "${target.file}", and do NOT re-run the command until that file exists.`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  const missingLocalExport = extractMissingLocalExportMember(output)
  if (missingLocalExport) {
    const target = missingLocalExport.diagnostic
    const available = resolveLocalModuleExports(target.file, missingLocalExport.specifier)
    const shownNames = available.slice(0, 24)
    const overflowNames = available.length - shownNames.length

    return [
      `[LOCAL MODULE DOES NOT EXPORT THAT NAME]`,
      `${target.file}, line ${target.line}${target.code ? ` (${target.code})` : ''}`,
      `  ${target.message}`,
      available.length > 0
        ? `"${missingLocalExport.specifier}" actually exports: ${shownNames.join(', ')}${overflowNames > 0 ? `, and ${overflowNames} more` : ''}.`
        : `The local module "${missingLocalExport.specifier}" could not be read, so its exported names are unknown here.`,
      `Directives:`,
      available.length > 0
        ? `1. Your next tool call MUST be "write_file" on "${target.file}", importing only names from the list above, or add "${missingLocalExport.memberName}" to the local module if that is the API the task requires.`
        : `1. Your next tool call MUST be "write_file" on "${target.file}", removing or correcting the unsupported "${missingLocalExport.memberName}" import.`,
      `2. Do NOT re-run the command with the same import; the local module does not currently export that name.`,
    ].join('\n')
  }

  // Ordered with the other branches that carry the fix rather than only the fault.
  const missingExport = extractMissingExportMember(output)
  if (missingExport) {
    const target = missingExport.diagnostic
    const available = resolvePackageExports(missingExport.packageName)
    const shownNames = available.slice(0, 24)
    const nameList = shownNames.join(', ')
    const overflowNames = available.length - shownNames.length

    return [
      `[THAT PACKAGE DOES NOT EXPORT THAT NAME]`,
      `${target.file}, line ${target.line}${target.code ? ` (${target.code})` : ''}`,
      `  ${target.message}`,
      available.length > 0
        ? `"${missingExport.packageName}" actually exports: ${nameList}${overflowNames > 0 ? `, and ${overflowNames} more` : ''}.`
        : `The installed copy of "${missingExport.packageName}" could not be read, so the names it does export are unknown here.`,
      `Directives:`,
      available.length > 0
        ? `1. Your next tool call MUST be "write_file" on "${target.file}", importing only names from the list above, or building "${missingExport.memberName}" yourself with plain JSX instead of importing it.`
        : `1. Your next tool call MUST be "write_file" on "${target.file}", building "${missingExport.memberName}" yourself with plain JSX instead of importing it from "${missingExport.packageName}".`,
      `2. Do NOT re-import "${missingExport.memberName}" from "${missingExport.packageName}", and do NOT install another package to obtain it.`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  const shown = diagnostics.slice(0, MAX_REPORTED)
  const overflow = diagnostics.length - shown.length
  const others = shown
    .slice(1)
    .map((d) => `- ${d.file} line ${d.line}: ${d.message}`)
    .join('\n')

  return [
    `[THE COMPILER NAMED THE FILE AND THE LINE — FIX THAT FILE]`,
    `${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}. The first one is:`,
    `  ${first.file}, line ${first.line}${first.column ? `, column ${first.column}` : ''}${first.code ? ` (${first.code})` : ''}`,
    `  ${first.message}`,
    others ? `Also reported${overflow > 0 ? ` (${overflow} more not listed)` : ''}:\n${others}` : '',
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "${first.file}", with the complete corrected content of that file.`,
    `2. Do NOT re-run the command until you have changed a file. It will report exactly these errors again, because nothing will have changed.`,
  ]
    .filter(Boolean)
    .join('\n')
}
