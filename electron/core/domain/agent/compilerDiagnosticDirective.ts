import type { SupportedToolName } from './agentTypes'
import { buildTestFailureDirective, extractFailingTest, testedModuleText } from './testFailureDiagnostic'

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

/**
 * `src/main.tsx(4,8): error TS1192: Module ... has no default export.`
 * The TypeScript compiler's own format, which is what this agent hits most.
 */
const TSC_PATTERN = /^\s*(\S+?)\((\d+),(\d+)\):\s*error\s+([A-Z]+\d+):\s*(.+)$/

/**
 * `src/App.tsx:12:5: error: Unexpected token` — the colon-separated form used by esbuild,
 * eslint, rustc and most POSIX tooling.
 */
const COLON_PATTERN = /^\s*(\S+?):(\d+):(\d+):\s*(?:error|ERROR)\s*:?\s*(.+)$/

/** Diagnostics beyond this add prompt weight without changing the next action. */
const MAX_REPORTED = 5

/** A remedy the compiler itself printed, e.g. */
const SUGGESTED_COMMAND_PATTERN = /\bTry\s+`([^`]+)`/

/** Every error the output names, in order, deduplicated by file+line. */
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

/** A diagnostic about resolving a module, which a config or install fix clears, not an edit. */
const MODULE_DIAGNOSTIC = /cannot find module|could not find a declaration file|failed to resolve import/i

/** A file inside an installed package: never something the agent should be told to edit. */
const IN_DEPENDENCY = /(^|[\\/])node_modules[\\/]/i

/** The import statement TypeScript itself proposes when an import and an export disagree. */
const SUGGESTED_IMPORT_PATTERN = /\bDid you mean to use '([^']+)' instead\?/
const IMPORT_SPECIFIER_PATTERN = /\bfrom\s+["']([^"']+)["']/

/** The only codes this remedy is read from. */
const EXPORT_MISMATCH_CODES = new Set(['TS2613', 'TS2614'])

/** A diagnostic whose fix the compiler already wrote out as a complete import statement. */
export interface ExportMismatch {
  diagnostic: CompilerDiagnostic
  /** The compiler's own replacement line, copied out of its message with nothing added. */
  suggestedImport: string
  /** Module named by that import, used to distinguish editable local code from a package. */
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

/** The first export/import mismatch the output reports, with the compiler's replacement line. */
export function extractExportMismatch(output: string): ExportMismatch | null {
  return findExportMismatch(parseCompilerDiagnostics(output).filter((d) => !IN_DEPENDENCY.test(d.file)))
}

/**
 * Formats secondary compiler diagnostics as a deferred advisory note rather than an immediate imperative.
 * Ensures the model addresses the primary blocking directive first without cognitive conflict.
 */
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

/** The directive for a command that failed with diagnostics a compiler already localised. */
/**
 * Relative import that resolves to nothing.
 * Orders creation of the imported target rather than rewriting the importing file.
 */
export interface MissingRelativeModule {
  diagnostic: CompilerDiagnostic
  /** The specifier as written, e.g. `./api`. */
  specifier: string
  /** Workspace-relative path of the file that has to be created. */
  expectedPath: string
}

const RELATIVE_MODULE_MISSING = /cannot find module\s+'(\.[^']*)'/i

/** Resolves a relative specifier against the importing file, and gives the new file the importer's own extension — `.ts` importing `./api` wants `api.ts`, `.tsx` importing `./Button` wants `Button.tsx`. */
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

/** The bundler refused JSX because the file's extension says plain JavaScript. */
const JSX_DISABLED =
  /JSX syntax is disabled|JSX syntax extension is not currently enabled|Unexpected JSX expression|name the file with the \.jsx or \.tsx extension/i
/** A `.js` path, never the `.js` prefix of `.jsx`/`.json` (a test file `App.test.jsx` is not `App.test.js`). */
const SCRIPT_FILE_REFERENCE = /([^\s\[\]()'"`]+\.(?:js|mjs|cjs))(?![\w])(?::(\d+))?/g

export interface JsxInScriptFile {
  file: string
  line?: number
  renamedFile: string
}

/**
 * JSX written into a `.js` file. tsc and Create React App parse it, but Vite 8/rolldown and
 * esbuild only enable JSX for `.jsx`/`.tsx`, so no rewrite of the content can fix the build:
 * the file has to be renamed (live full task run of 2026-09-23, src/App.js).
 */
export function extractJsxInScriptFile(output: string): JsxInScriptFile | null {
  if (!output || !JSX_DISABLED.test(output)) return null
  for (const match of output.matchAll(SCRIPT_FILE_REFERENCE)) {
    const file = match[1].replace(/\\/g, '/')
    if (IN_DEPENDENCY.test(file) || /^(?:file|https?):/i.test(file)) continue
    return { file, line: match[2] ? Number(match[2]) : undefined, renamedFile: file.replace(/\.[mc]?js$/i, '.jsx') }
  }
  return null
}

/** Facts about the workspace a directive may need, injected because this module is pure domain. */
export interface DiagnosticWorkspaceFacts {
  /** True when the installed package declares a stylesheet entry (`style`, or `exports["."].style`). */
  packageHasStyleEntry?: (packageName: string) => boolean
  /** The workspace-relative form of a path the tool printed absolute. */
  toWorkspaceRelative?: (filePath: string) => string
  /** Whether a workspace-relative file exists. */
  fileExists?: (workspaceRelativePath: string) => boolean
  /** Whether an installed package provides this command (`node_modules/.bin/<name>`). */
  binaryInstalled?: (name: string) => boolean
  /** The text of a workspace-relative file, or null when it cannot be read. */
  readWorkspaceFile?: (workspaceRelativePath: string) => string | null
  /** The source of the local module a relative import resolves to, or null. */
  readLocalModuleSource?: (importingFile: string, specifier: string) => string | null
}

export interface MissingScriptProgram {
  /** The npm script that ran, e.g. `build`. */
  script: string
  /** Its body as npm echoed it, e.g. `react-scripts build`. */
  body: string
  /** The program the shell could not find, e.g. `react-scripts`. */
  program: string
}

/** cmd.exe (English and Italian) and POSIX shells reporting a program that is not on PATH. */
const PROGRAM_NOT_FOUND: RegExp[] = [
  /^['"]?([\w@./-]+?)['"]? (?:is not recognized as an internal or external command|non [^\s]{1,3} riconosciuto come comando interno o esterno)/m,
  /^(?:sh|bash|zsh)(?:: line \d+)?: (?:\d+: )?([\w@./-]+): (?:command )?not found/m,
]
/** npm's echo of the script it runs: `> name@version script` then `> body`. */
const NPM_SCRIPT_ECHO = /^> \S+@\S+ ([\w:-]+)\r?\n> (.+)$/m
/** Bundler CLIs a declared Vite can stand in for, with the Vite command for each script role. */
const VITE_REPLACEABLE = new Set(['react-scripts', 'webpack', 'webpack-cli', 'parcel'])
/** Commands whose package has another name. */
const PROGRAM_PACKAGES: Record<string, string> = { tsc: 'typescript', 'webpack-cli': 'webpack-cli', vite: 'vite', 'react-scripts': 'react-scripts' }

/**
 * An npm script whose program is not installed. Live full task run 23 of 2026-09-24: the build
 * script ran `react-scripts build` in a Vite project that never installed react-scripts; under the
 * generic auto-healing text the model rewrote package.json until the edit-loop guard blocked it.
 */
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
]
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i
const STYLESHEET = /\.(?:css|pcss|scss|sass|less)$/i

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
  return [`./${name}`, `../${name}`, `./styles/${name}`, `../styles/${name}`].filter((candidate) => candidate !== specifier)
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

/**
 * A stylesheet `@import` the bundler could not resolve. Live full task run 16 of 2026-09-24:
 * `@import "tailwindcss/tailwind.min.css"` in src/index.css failed the build and no directive
 * named the file, so the model tried to reinstall Tailwind and invented a typecheck script.
 */
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
  /** The stylesheet PostCSS could not parse, as the bundler printed it. */
  file: string
  line?: number
  /** PostCSS's reason, e.g. `Unknown word`. */
  reason?: string
}

const CSS_SYNTAX_ERROR = /CssSyntaxError:\s*(?:\[postcss\]\s*)?(?:(\S+?\.(?:css|pcss|scss|sass|less)):(\d+):\d+:\s*)?(.*)$/m

/**
 * A stylesheet PostCSS could not parse. Live full task run 25 of 2026-09-24: a CssSyntaxError under
 * `[plugin vite:css]` got the generic auto-healing text, and the build was re-run unchanged six times.
 */
export function extractCssSyntaxFailure(output: string): CssSyntaxFailure | null {
  const text = (output || '').replace(ANSI_SEQUENCE, '')
  const match = CSS_SYNTAX_ERROR.exec(text)
  if (!match) return null
  const file = (match[1] ?? CSS_PLUGIN_FILE.exec(text)?.[1])?.replace(/\\/g, '/')
  if (!file) return null
  const reason = match[3]?.trim()
  return { file, ...(match[2] ? { line: Number(match[2]) } : {}), ...(reason ? { reason } : {}) }
}

function buildCssSyntaxDirective(failure: CssSyntaxFailure, facts: DiagnosticWorkspaceFacts): string {
  const file = facts.toWorkspaceRelative ? facts.toWorkspaceRelative(failure.file) : failure.file
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

/** Tools beyond the file edit that the directive built from this output orders. */
export function diagnosticFixRequiredTools(output: string, facts: DiagnosticWorkspaceFacts = {}): SupportedToolName[] {
  if (extractJsxInScriptFile(output)) return ['move_file']
  const missingProgram = extractMissingScriptProgram(output)
  if (missingProgram && !(VITE_REPLACEABLE.has(missingProgram.program) && facts.binaryInstalled?.('vite'))) return ['run_command']
  return []
}

/** The file the directive built from this output will order written, or null when it orders a command instead. */
export function diagnosticFixTargetFile(output: string, facts: DiagnosticWorkspaceFacts = {}): string | null {
  if (extractSuggestedCommand(output)) return null
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

  // Ordered after the export mismatch and before the generic branch: like that one this knows
  // the exact fix, unlike that one the file to write is NOT the file the error is reported on.
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
