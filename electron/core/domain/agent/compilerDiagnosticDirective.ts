/**
 * Compiler Diagnostic Directive.
 *
 * Turns a compiler's own error output into the single next action, instead of a paragraph that
 * describes several.
 *
 * The text this replaces read: *"Inspect the stack trace, locate the failing file, syntax, or
 * command parameter, apply the necessary fix using replace_file_content or write_file, and
 * re-run the command autonomously."* Two imperatives in one sentence — fix it, and re-run it —
 * and in the live run of 2026-08-24 the model did the second. `npx tsc --noEmit` reported three
 * errors with file, line, code and message at step 21, and the model re-ran the identical
 * command at steps 22 through 31 without touching a file. It is the lesson this project already
 * wrote down for the plan block and the loop guard — one message carries one instruction —
 * simply never applied to this text.
 *
 * The information needed to say something better was already in hand: a compiler names the file
 * and the line. So the directive names them too, and says explicitly not to re-run until the
 * file has changed. It also stops proposing `replace_file_content`, which the same run showed
 * this model cannot emit validly (see toolRejectionEscalation.ts).
 *
 * Pure domain: the caller supplies the command output.
 */

export interface CompilerDiagnostic {
  file: string
  line: number
  column?: number
  /** Compiler error code when the format carries one (`TS2304`, `E0433`); absent otherwise. */
  code?: string
  message: string
}

/**
 * The command the compiler suggested, when it suggested one, normalised to `npm install`.
 *
 * `npm i` is accepted because that is what TypeScript prints, and rejected commands that are
 * not installs are ignored: this exists to catch "install the missing declarations", not to
 * run arbitrary text the compiler happened to quote.
 */
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

/**
 * A remedy the compiler itself printed, e.g. TypeScript's
 * "Try `npm i --save-dev @types/react` if it exists".
 *
 * Load-bearing, and found the hard way. In the live run of 2026-08-24 the build failed with
 * `TS7016: Could not find a declaration file for module 'react'` from step 16 to step 49 —
 * the SAME error every time — while this module's directive kept ordering `write_file` on
 * `src/App.tsx`, because that is the file the diagnostic names. No edit to that file could
 * ever have fixed it: the remedy is installing `@types/react`, and the compiler printed the
 * command in the very next line of its own output.
 *
 * Taken verbatim rather than synthesised, for the same reason `npmResolutionConflict.ts` copies
 * npm's version range instead of composing one: the tool that diagnosed the problem is a better
 * source for the fix than anything inferred from it.
 */
const SUGGESTED_COMMAND_PATTERN = /\bTry\s+`([^`]+)`/

/**
 * Every error the output names, in order, deduplicated by file+line.
 *
 * Deliberately narrow, like every other parser in this project: a line is a diagnostic only
 * when it carries a file, a line number and the word `error`. Anything else is left alone,
 * because a false diagnostic sends the model editing a file that was never the problem.
 */
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

/**
 * The import statement TypeScript itself proposes when an import and an export disagree.
 *
 * `TS2613` — *Module '"X"' has no default export. Did you mean to use 'import { Y } from "X"'
 * instead?* — and `TS2614` — *Module '"X"' has no exported member 'Y'. Did you mean to use
 * 'import Y from "X"' instead?* — are the two halves of one defect, and blueprint §5.6i names it
 * the current bottleneck of generated code: the model writes a default import against a named
 * export, or the reverse.
 *
 * The statement is single-quoted and carries double quotes around the module specifier, so
 * `[^']+` is enough and no escaping is involved.
 */
const SUGGESTED_IMPORT_PATTERN = /\bDid you mean to use '([^']+)' instead\?/

/**
 * The only codes this remedy is read from.
 *
 * `TS1192` also says "has no default export", but prints no suggestion after it — there is
 * nothing verbatim to copy, so it keeps falling through to the ordinary file-and-line directive
 * instead of reaching a branch that would have to invent the replacement line itself.
 */
const EXPORT_MISMATCH_CODES = new Set(['TS2613', 'TS2614'])

/** A diagnostic whose fix the compiler already wrote out as a complete import statement. */
export interface ExportMismatch {
  diagnostic: CompilerDiagnostic
  /** The compiler's own replacement line, copied out of its message with nothing added. */
  suggestedImport: string
}

function findExportMismatch(diagnostics: CompilerDiagnostic[]): ExportMismatch | null {
  for (const diagnostic of diagnostics) {
    if (!diagnostic.code || !EXPORT_MISMATCH_CODES.has(diagnostic.code)) continue
    const match = SUGGESTED_IMPORT_PATTERN.exec(diagnostic.message)
    if (!match) continue
    return { diagnostic, suggestedImport: match[1].trim() }
  }
  return null
}

/**
 * The first export/import mismatch the output reports, with the compiler's replacement line.
 *
 * The same reasoning as `extractSuggestedCommand`, applied to an edit instead of an install:
 * tsc has already decided which of the two sides is wrong and printed the statement that fixes
 * it, and paraphrasing that into "correct the import" discards the one thing a 7B model cannot
 * recover on its own — whether the target module exports a default or a name, and which name.
 * Blueprint §6.2.1, structure before directives: hand over the objective datum, do not restate
 * it. The clause survived parsing already (it is part of `message`), but nothing ever pointed
 * at it, and it reached the model buried mid-sentence in a line whose only instruction was
 * "write the complete corrected content of that file".
 *
 * Errors inside `node_modules` are dropped here too: a mismatch against a dependency's own
 * declaration file is never fixed by editing that file.
 */
export function extractExportMismatch(output: string): ExportMismatch | null {
  return findExportMismatch(parseCompilerDiagnostics(output).filter((d) => !IN_DEPENDENCY.test(d.file)))
}

/**
 * What is left to fix once the directive currently in force has done its job — named, not ordered.
 *
 * A build output routinely carries both kinds at once, and the directive that wins suppresses the
 * other entirely. Measured twice, with two different winners: run 6 of 2026-08-25 lost a `TS1192`
 * behind the missing-dependency branch, and run 8 lost `TS7031`, `TS1192` and `TS2741` behind the
 * module-resolution directive — `THE COMPILER NAMED THE FILE AND THE LINE` did not appear once in
 * fifty steps, and the session closed at 0/14. The code errors were in the prompt the whole time
 * with nothing pointing at them.
 *
 * This is a NOTE, deliberately, and the distinction is the one §5.6 was built on: a message
 * carries one instruction for **now**. Ordering the config fix and the file edit in the same turn
 * is how a correct directive gets overwritten by another correct directive. So this states what
 * the compiler also reported and says it comes after — no imperative, no tool name, no "next tool
 * call MUST".
 *
 * Returns null when every diagnostic is about module resolution, because then the directive in
 * force already covers all of them and there is nothing further to name.
 */
export function buildDeferredDiagnosticNote(output: string): string | null {
  const codeErrors = parseCompilerDiagnostics(output).filter(
    (d) => !MODULE_DIAGNOSTIC.test(d.message) && !IN_DEPENDENCY.test(d.file)
  )
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

/**
 * The directive for a command that failed with diagnostics a compiler already localised.
 *
 * One instruction: open the first file it names and fix that error. The re-run is stated as a
 * consequence of the fix, never as a second thing to do now — that separation is the whole
 * point, and the reason the previous wording produced ten steps of re-running.
 *
 * Returns null when nothing parsed, so the caller keeps its ordinary text.
 */
/**
 * A relative import that resolves to nothing.
 *
 * `TS2307: Cannot find module './api'` is reported ON the importing file, and the generic branch
 * below would therefore order that file rewritten. Rewriting it cannot create the module: the
 * file that is missing is the one being IMPORTED. This is the same wrong assumption
 * verificationAttemptTracker.ts records being made three times in one day — that every compiler
 * error is fixed by editing the file it points at.
 *
 * Measured 2026-08-25T19:44, session live-full-task, step 21: `src/services/index.ts` imported
 * './api' and './auth', neither of which existed. The directive ordered `write_file` on
 * `src/services/index.ts`. The run ended 0/14 with a workspace holding a .js twin of every .tsx
 * file, which is what a model does when told to rewrite a file that is not the problem.
 *
 * Package imports are excluded here on purpose: a bare specifier that does not resolve is a
 * missing dependency, and the install branch above already owns that case.
 */
export interface MissingRelativeModule {
  diagnostic: CompilerDiagnostic
  /** The specifier as written, e.g. `./api`. */
  specifier: string
  /** Workspace-relative path of the file that has to be created. */
  expectedPath: string
}

const RELATIVE_MODULE_MISSING = /cannot find module\s+'(\.[^']*)'/i

/**
 * Resolves a relative specifier against the importing file, and gives the new file the
 * importer's own extension — `.ts` importing `./api` wants `api.ts`, `.tsx` importing
 * `./Button` wants `Button.tsx`. A specifier that already carries an extension keeps it.
 */
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

/**
 * A name imported from a package the package does not export.
 *
 * `TS2305` states what is wrong and nothing about what would be right. Measured 2026-08-25T19:59,
 * steps 42-43: `@headlessui/react` was reported as exporting neither `Card` nor `List`, the
 * directive ordered TaskCard.tsx rewritten, and the model rewrote it with the identical import.
 * It was not disobeying — it had no second candidate, and no way to obtain one, since it never
 * calls `read_file` and the answer lives in a .d.ts inside node_modules.
 *
 * Relative specifiers are excluded: a local file that lacks an export is fixed by looking at
 * that file, which is a different datum and a different directive.
 */
export interface MissingExportMember {
  diagnostic: CompilerDiagnostic
  /** The package the import names, e.g. `@headlessui/react`. */
  packageName: string
  /** The member that is not there, e.g. `Card`. */
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

/**
 * The file the directive built from this output will order written, or null when it orders a
 * command instead.
 *
 * Mirrors the branch precedence of buildDiagnosticFixDirective deliberately, rather than being
 * derived from its text: the caller needs the path as a path — to read that file off disk and
 * hand its current content to the model — and parsing it back out of a rendered directive would
 * couple the two through prose.
 *
 * The install branch returns null: an install changes no file, so there is nothing to show.
 * A missing relative module returns the path that has to be CREATED, which by definition does not
 * exist yet; reading it yields nothing, which is the correct amount to say about a file that is
 * not there.
 */
export function diagnosticFixTargetFile(output: string): string | null {
  if (extractSuggestedCommand(output)) return null

  const mismatch = extractExportMismatch(output)
  if (mismatch) return mismatch.diagnostic.file

  const missingRelative = extractMissingRelativeModule(output)
  if (missingRelative) return missingRelative.expectedPath

  const missingExport = extractMissingExportMember(output)
  if (missingExport) return missingExport.diagnostic.file

  const first = parseCompilerDiagnostics(output).filter((d) => !IN_DEPENDENCY.test(d.file))[0]
  return first ? first.file : null
}

export function buildDiagnosticFixDirective(
  output: string,
  /**
   * What a package exports, injected because this module is pure domain and the answer lives in
   * a .d.ts under node_modules. Returning an empty array means "could not read it", and the
   * directive then says less rather than claiming the package exports nothing.
   */
  resolvePackageExports: (packageName: string) => string[] = () => []
): string | null {
  const all = parseCompilerDiagnostics(output)
  if (all.length === 0) return null

  // Errors inside an installed package are never the project's code, and telling the model to
  // rewrite one sends it editing a dependency. Run 10 of 2026-08-25 pinned `typescript@^4.7.3`
  // and then could not parse the `@types/node` npm had installed: every diagnostic pointed into
  // `node_modules/@types/node/ffi.d.ts`. Nothing in the workspace could have fixed that.
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

  // The compiler named a remedy. Editing the file it also named cannot work — a missing
  // declaration package is not a code defect — and ordering the edit anyway is what produced
  // thirty-three steps against an unchanging `TS7016`.
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
    const rest = restShown
      .map((d) => `- ${d.file} line ${d.line}${d.code ? ` (${d.code})` : ''}: ${d.message}`)
      .join('\n')

    return [
      `[THE COMPILER WROTE THE CORRECT IMPORT FOR YOU — COPY IT VERBATIM]`,
      `${target.file}, line ${target.line}${target.column ? `, column ${target.column}` : ''} (${target.code})`,
      `  ${target.message}`,
      `The import and the export of that module disagree. The compiler resolved which side is wrong and printed the statement that fixes it, character for character:`,
      `  ${mismatch.suggestedImport}`,
      `Use that line exactly as printed. Do NOT rename the export, do NOT edit the module being imported, and do NOT guess a different member name — the compiler read that module and you have not.`,
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
    const rest = restShown
      .map((d) => `- ${d.file} line ${d.line}${d.code ? ` (${d.code})` : ''}: ${d.message}`)
      .join('\n')

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

  // Ordered with the other branches that carry the fix rather than only the fault. TS2305 says
  // what is wrong and nothing about what would be right, and the model has no way to find out:
  // it never calls read_file, and the answer is in a .d.ts inside node_modules. Measured
  // 2026-08-25T19:59 steps 42-43 — told that @headlessui/react exports neither `Card` nor
  // `List`, it rewrote the file with the identical import, because it had no second candidate.
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
