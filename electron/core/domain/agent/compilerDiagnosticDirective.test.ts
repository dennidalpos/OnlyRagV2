import { describe, it, expect } from 'vitest'
import { buildDiagnosticFixDirective, extractSuggestedCommand, parseCompilerDiagnostics } from './compilerDiagnosticDirective'

/** The exact output `npx tsc --noEmit` produced at step 21 of the live run of 2026-08-24. */
const TSC_OUTPUT = [
  "src/main.tsx(4,8): error TS1192: Module '\"C:/Users/x/src/App\"' has no default export.",
  "src/routes/index.tsx(8,15): error TS2304: Cannot find name 'DashboardPage'.",
  "src/routes/index.tsx(12,15): error TS2304: Cannot find name 'TasksPage'.",
].join('\n')

describe('parseCompilerDiagnostics', () => {
  it('reads the TypeScript compiler format', () => {
    const found = parseCompilerDiagnostics(TSC_OUTPUT)

    expect(found).toHaveLength(3)
    expect(found[0]).toMatchObject({ file: 'src/main.tsx', line: 4, column: 8, code: 'TS1192' })
    expect(found[0].message).toContain('has no default export')
  })

  it('reads the colon-separated format the rest of the toolchain uses', () => {
    const found = parseCompilerDiagnostics('src/App.tsx:12:5: error: Unexpected token')

    expect(found[0]).toMatchObject({ file: 'src/App.tsx', line: 12, column: 5 })
    expect(found[0].message).toBe('Unexpected token')
  })

  it('keeps one entry per file and line', () => {
    const repeated = `${TSC_OUTPUT}\n${TSC_OUTPUT}`

    expect(parseCompilerDiagnostics(repeated)).toHaveLength(3)
  })

  it('says nothing about output that names no file and line', () => {
    // A false diagnostic sends the model editing a file that was never the problem.
    expect(parseCompilerDiagnostics('npm ERR! code ERESOLVE\nnpm ERR! could not resolve')).toEqual([])
    expect(parseCompilerDiagnostics('error: something went wrong')).toEqual([])
    expect(parseCompilerDiagnostics('')).toEqual([])
  })

  it('ignores warnings, which are not what failed the command', () => {
    expect(parseCompilerDiagnostics('src/App.tsx(3,1): warning TS6133: unused variable')).toEqual([])
  })
})

describe('buildDiagnosticFixDirective', () => {
  it('names the first file and line as the one next action', () => {
    const directive = buildDiagnosticFixDirective(TSC_OUTPUT)!

    expect(directive).toContain('src/main.tsx, line 4, column 8 (TS1192)')
    expect(directive).toContain('Your next tool call MUST be "write_file" on "src/main.tsx"')
  })

  it('forbids the re-run that ate ten steps, and says why', () => {
    const directive = buildDiagnosticFixDirective(TSC_OUTPUT)!

    expect(directive).toContain('Do NOT re-run the command until you have changed a file')
    expect(directive).toContain('nothing will have changed')
  })

  it('does not propose the tool this model cannot emit', () => {
    // `replace_file_content` needs an exact-match parameter the model kept omitting; the old
    // wording offered it first. See toolRejectionEscalation.ts.
    expect(buildDiagnosticFixDirective(TSC_OUTPUT)).not.toContain('replace_file_content')
  })

  it('lists the other errors without turning them into a second instruction', () => {
    const directive = buildDiagnosticFixDirective(TSC_OUTPUT)!

    expect(directive).toContain('src/routes/index.tsx line 8')
    // Exactly one numbered action to take, plus the prohibition on re-running.
    expect(directive.match(/^1\. /m)).not.toBeNull()
    expect(directive.match(/^3\. /m)).toBeNull()
  })

  it('returns null when the output localises nothing, so the caller keeps its own text', () => {
    expect(buildDiagnosticFixDirective('npm ERR! code E404')).toBeNull()
  })
})

/**
 * The error that ran from step 16 to step 49 of the live run of 2026-08-24, unchanged, while
 * the directive kept ordering a rewrite of the file it names. No edit to `src/App.tsx` could
 * fix it: the remedy is installing `@types/react`, and TypeScript printed the command itself.
 */
const TS7016_OUTPUT = [
  "src/App.tsx(2,19): error TS7016: Could not find a declaration file for module 'react'. 'node_modules/react/index.js' implicitly has an 'any' type.",
  "  Try `npm i --save-dev @types/react` if it exists or add a new declaration (.d.ts) file containing `declare module 'react';`",
].join('\n')

describe('extractSuggestedCommand', () => {
  it('takes the command the compiler printed, verbatim', () => {
    expect(extractSuggestedCommand(TS7016_OUTPUT)).toBe('npm install --save-dev @types/react')
  })

  it('normalises only the npm shorthand, leaving the rest untouched', () => {
    expect(extractSuggestedCommand('  Try `npm i -D @types/node`')).toBe('npm install -D @types/node')
    expect(extractSuggestedCommand('  Try `pnpm add -D @types/node`')).toBe('pnpm add -D @types/node')
  })

  it('ignores quoted text that is not an install command', () => {
    // This exists to catch "install the missing declarations", not to run arbitrary text the
    // compiler happened to put in backticks.
    expect(extractSuggestedCommand('  Try `declare module \'react\';` instead')).toBeNull()
    expect(extractSuggestedCommand('  Try `rm -rf node_modules`')).toBeNull()
  })

  it('says nothing when the compiler suggested nothing', () => {
    expect(extractSuggestedCommand(TSC_OUTPUT)).toBeNull()
    expect(extractSuggestedCommand('')).toBeNull()
  })
})

describe('buildDiagnosticFixDirective — when the compiler named the remedy', () => {
  it('orders the install instead of an edit that cannot work', () => {
    const directive = buildDiagnosticFixDirective(TS7016_OUTPUT)!

    expect(directive).toContain('MUST be "run_command" with the command: npm install --save-dev @types/react')
    expect(directive).not.toContain('MUST be "write_file"')
  })

  it('forbids the rewrite explicitly, and says why it would not help', () => {
    const directive = buildDiagnosticFixDirective(TS7016_OUTPUT)!

    expect(directive).toContain('Do NOT rewrite "src/App.tsx"')
    expect(directive).toContain('until the package is installed')
  })

  it('still orders the file fix when no remedy was printed', () => {
    expect(buildDiagnosticFixDirective(TSC_OUTPUT)).toContain('MUST be "write_file" on "src/main.tsx"')
  })
})
