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

/**
 * The directive for a command that failed with diagnostics a compiler already localised.
 *
 * One instruction: open the first file it names and fix that error. The re-run is stated as a
 * consequence of the fix, never as a second thing to do now — that separation is the whole
 * point, and the reason the previous wording produced ten steps of re-running.
 *
 * Returns null when nothing parsed, so the caller keeps its ordinary text.
 */
export function buildDiagnosticFixDirective(output: string): string | null {
  const diagnostics = parseCompilerDiagnostics(output)
  if (diagnostics.length === 0) return null

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
