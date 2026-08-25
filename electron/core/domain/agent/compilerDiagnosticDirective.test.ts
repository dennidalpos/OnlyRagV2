import { describe, it, expect } from 'vitest'
import {
  buildDiagnosticFixDirective,
  buildDeferredDiagnosticNote,
  extractExportMismatch,
  extractSuggestedCommand,
  parseCompilerDiagnostics,
  extractMissingRelativeModule,
  extractMissingExportMember,
  diagnosticFixTargetFile,
  resolveRelativeImportPath,
} from './compilerDiagnosticDirective'

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

/**
 * The bottleneck blueprint §5.6i names: the model writes a default import against a named
 * export, or a named import against a default one. Both messages are the shapes `tsc` prints,
 * and both end with the statement that fixes the file.
 */
const TS2613_OUTPUT =
  'src/main.tsx(2,8): error TS2613: Module \'"C:/w/src/App"\' has no default export. Did you mean to use \'import { App } from "C:/w/src/App"\' instead?'
const TS2614_OUTPUT =
  'src/routes/index.tsx(3,10): error TS2614: Module \'"../pages/Dashboard"\' has no exported member \'Dashboard\'. Did you mean to use \'import Dashboard from "../pages/Dashboard"\' instead?'

describe('extractExportMismatch', () => {
  it('takes the replacement import the compiler printed, verbatim', () => {
    expect(extractExportMismatch(TS2613_OUTPUT)!.suggestedImport).toBe('import { App } from "C:/w/src/App"')
    expect(extractExportMismatch(TS2614_OUTPUT)!.suggestedImport).toBe('import Dashboard from "../pages/Dashboard"')
  })

  it('carries the diagnostic that owns the suggestion, not just the text', () => {
    expect(extractExportMismatch(TS2614_OUTPUT)!.diagnostic).toMatchObject({
      file: 'src/routes/index.tsx',
      line: 3,
      column: 10,
      code: 'TS2614',
    })
  })

  it('finds the mismatch even when it is not the first error reported', () => {
    const output = `src/routes/index.tsx(8,15): error TS2304: Cannot find name 'TasksPage'.\n${TS2613_OUTPUT}`

    expect(extractExportMismatch(output)!.diagnostic.file).toBe('src/main.tsx')
  })

  it('says nothing for the codes that print no suggestion to copy', () => {
    // TS1192 also says "has no default export", but names no replacement. Inventing one is
    // exactly what this branch exists not to do.
    expect(extractExportMismatch(TSC_OUTPUT)).toBeNull()
    expect(extractExportMismatch('')).toBeNull()
  })

  it('ignores a mismatch reported against a file inside an installed package', () => {
    const inDeps =
      'node_modules/some-lib/dist/index.d.ts(4,8): error TS2613: Module \'"./inner"\' has no default export. Did you mean to use \'import { Inner } from "./inner"\' instead?'

    expect(extractExportMismatch(inDeps)).toBeNull()
  })
})

describe('buildDiagnosticFixDirective — export/import mismatch', () => {
  it('quotes the compiler suggestion verbatim, naming file and line', () => {
    const directive = buildDiagnosticFixDirective(TS2613_OUTPUT)!

    expect(directive).toContain('src/main.tsx, line 2, column 8 (TS2613)')
    // The whole message, suggestion included, plus the suggestion isolated on its own line.
    expect(directive).toContain('Did you mean to use \'import { App } from "C:/w/src/App"\' instead?')
    expect(directive).toContain('\n  import { App } from "C:/w/src/App"\n')
  })

  it('prescribes exactly one write_file, on the file the compiler named', () => {
    const directive = buildDiagnosticFixDirective(TS2614_OUTPUT)!

    expect(directive).toContain(
      '1. Your next tool call MUST be "write_file" on "src/routes/index.tsx", with the complete content of that file, in which line 3 is replaced by exactly: import Dashboard from "../pages/Dashboard"'
    )
    // §6.2.2: one imperative for now. The prohibition on re-running is the only other numbered
    // line, exactly as in the ordinary file-and-line directive.
    expect(directive.match(/^\d+\. /gm)).toHaveLength(2)
    expect(directive).toContain('Do NOT re-run the command until you have changed a file')
  })

  it('forbids editing the other side of the mismatch, which the model cannot see', () => {
    const directive = buildDiagnosticFixDirective(TS2613_OUTPUT)!

    expect(directive).toContain('Do NOT rename the export')
    expect(directive).toContain('do NOT edit the module being imported')
  })

  it('replaces the generic file-and-line directive instead of being appended to it', () => {
    const directive = buildDiagnosticFixDirective(TS2613_OUTPUT)!

    expect(directive).toContain('THE COMPILER WROTE THE CORRECT IMPORT FOR YOU')
    expect(directive).not.toContain('THE COMPILER NAMED THE FILE AND THE LINE')
  })

  it('wins over an unrelated first error, because its fix is the one already written down', () => {
    const mixed = [
      "src/routes/index.tsx(8,15): error TS2304: Cannot find name 'TasksPage'.",
      TS2613_OUTPUT,
    ].join('\n')
    const directive = buildDiagnosticFixDirective(mixed)!

    expect(directive).toContain('"write_file" on "src/main.tsx"')
    // The other error is named, never ordered.
    expect(directive).toContain("src/routes/index.tsx line 8 (TS2304): Cannot find name 'TasksPage'.")
    expect(directive.match(/^\d+\. /gm)).toHaveLength(2)
  })

  it('still defers to the install when the compiler also named a package to install', () => {
    // A missing declaration package blocks the file the same way it blocked TS7016 for
    // thirty-three steps; the edit is worth nothing until the install lands.
    const mixed = `${TS7016_OUTPUT}\n${TS2613_OUTPUT}`

    expect(buildDiagnosticFixDirective(mixed)!).toContain('MUST be "run_command" with the command: npm install --save-dev @types/react')
  })

  it('leaves TS1192 on the ordinary directive, since there is nothing to quote', () => {
    expect(buildDiagnosticFixDirective(TSC_OUTPUT)!).toContain('THE COMPILER NAMED THE FILE AND THE LINE')
  })
})

describe('buildDeferredDiagnosticNote', () => {
  // Verbatim shape from run 8 of 2026-08-25: a module error and code errors in one output.
  const MIXED = [
    "src/App.tsx(3,56): error TS2792: Cannot find module 'react-router-dom'.",
    "src/components/Button.tsx(6,19): error TS7031: Binding element 'children' implicitly has an 'any' type.",
    "src/main.tsx(6,8): error TS1192: Module '.../src/App' has no default export.",
  ].join('\n')

  it('names the code errors the winning directive does not fix', () => {
    const note = buildDeferredDiagnosticNote(MIXED)!

    expect(note).toContain('ALSO REPORTED, AFTER THE DIRECTIVE ABOVE')
    expect(note).toContain('src/components/Button.tsx line 6')
    expect(note).toContain('src/main.tsx line 6')
    // The module error belongs to the directive above, not here.
    expect(note).not.toContain('react-router-dom')
  })

  it('gives no instruction for now, so one message still carries one imperative', () => {
    const note = buildDeferredDiagnosticNote(MIXED)!

    expect(note).toContain('Do not act on them in this step')
    expect(note).not.toMatch(/next tool call MUST/i)
    expect(note).not.toMatch(/\bwrite_file\b/)
  })

  it('says nothing when every error is about resolving a module', () => {
    expect(buildDeferredDiagnosticNote("src/App.tsx(3,56): error TS2792: Cannot find module 'x'.")).toBeNull()
    expect(buildDeferredDiagnosticNote('')).toBeNull()
  })
})

describe('diagnostics inside node_modules', () => {
  // Run 10 of 2026-08-25 pinned typescript@^4.7.3, which then could not parse the @types/node
  // npm had installed. Every error pointed into a dependency; no edit in the workspace could
  // have fixed any of them.
  const IN_DEPS = [
    'node_modules/@types/node/ffi.d.ts(277,43): error TS1109: Expression expected.',
    'node_modules/@types/node/ffi.d.ts(285,30): error TS1005: \',\' expected.',
  ].join('\n')

  it('never orders an edit to a dependency, and names the version mismatch instead', () => {
    const directive = buildDiagnosticFixDirective(IN_DEPS)!

    expect(directive).toContain('INSIDE AN INSTALLED PACKAGE')
    expect(directive).toContain('npm install --save-dev typescript@latest')
    expect(directive).toContain('Do NOT edit any file under node_modules')
    expect(directive).not.toMatch(/"write_file" on "node_modules/)
  })

  it('still points at the project file when one is also reported', () => {
    const mixed = `${IN_DEPS}\nsrc/App.tsx(4,8): error TS1192: Module has no default export.`

    expect(buildDiagnosticFixDirective(mixed)!).toContain('"write_file" on "src/App.tsx"')
  })

  it('keeps dependency errors out of the deferred note as well', () => {
    expect(buildDeferredDiagnosticNote(IN_DEPS)).toBeNull()
  })
})

/**
 * Measured 2026-08-25T19:44, session live-full-task, step 21. `src/services/index.ts` imported
 * './api' and './auth', neither of which existed. The directive ordered `write_file` on
 * `src/services/index.ts` — the file that reports the error, not the file that is missing.
 * Rewriting the importer cannot create the module, so the same two errors came back and the run
 * ended 0/14 with a .js twin of every .tsx file in the workspace.
 *
 * verificationAttemptTracker.ts already records this exact assumption being made three times in
 * one day: that every compiler error is fixed by editing the file it points at.
 */
describe('missing relative module', () => {
  const OUTPUT = [
    "src/services/index.ts(2,15): error TS2307: Cannot find module './api' or its corresponding type declarations.",
    "src/services/index.ts(3,15): error TS2307: Cannot find module './auth' or its corresponding type declarations.",
  ].join('\n')

  it('resolves the specifier against the importing file and keeps its extension', () => {
    expect(resolveRelativeImportPath('src/services/index.ts', './api')).toBe('src/services/api.ts')
    expect(resolveRelativeImportPath('src/App.tsx', './Button')).toBe('src/Button.tsx')
    expect(resolveRelativeImportPath('src/pages/Home.tsx', '../components/Card')).toBe('src/components/Card.tsx')
  })

  it('leaves a specifier that already carries an extension alone', () => {
    expect(resolveRelativeImportPath('src/main.ts', './styles.css')).toBe('src/styles.css')
  })

  it('names the imported file, not the importing one', () => {
    const found = extractMissingRelativeModule(OUTPUT)
    expect(found?.expectedPath).toBe('src/services/api.ts')
    expect(found?.specifier).toBe('./api')
    expect(found?.diagnostic.file).toBe('src/services/index.ts')
  })

  it('ignores a bare package specifier, which the install branch owns', () => {
    const pkg = "src/main.tsx(2,25): error TS2307: Cannot find module 'react-router-dom' or its corresponding type declarations."
    expect(extractMissingRelativeModule(pkg)).toBeNull()
  })

  it('orders creating the missing file and forbids rewriting the importer', () => {
    const directive = buildDiagnosticFixDirective(OUTPUT)
    expect(directive).toContain('THE IMPORTED FILE DOES NOT EXIST')
    expect(directive).toContain('"write_file" on "src/services/api.ts"')
    expect(directive).toContain('Do NOT rewrite "src/services/index.ts"')
    // One imperative for now, as everywhere else in this module.
    expect((directive || '').split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(2)
  })
})

/**
 * The measured case, 2026-08-25T19:59 steps 42-43: `@headlessui/react` exports neither `Card` nor
 * `List`. The generic branch ordered the importing file rewritten and said nothing about what the
 * package does export, so the model rewrote it with the identical import — it had no second
 * candidate and no way to obtain one.
 */
describe('missing export member', () => {
  const OUTPUT = [
    `src/components/TaskCard.tsx(3,10): error TS2305: Module '"@headlessui/react"' has no exported member 'Card'.`,
    `src/components/TaskCard.tsx(3,16): error TS2305: Module '"@headlessui/react"' has no exported member 'List'.`,
  ].join('\n')

  it('names the package and the member that is not there', () => {
    const found = extractMissingExportMember(OUTPUT)
    expect(found?.packageName).toBe('@headlessui/react')
    expect(found?.memberName).toBe('Card')
    expect(found?.diagnostic.file).toBe('src/components/TaskCard.tsx')
  })

  it('ignores a relative specifier, which is a different datum and a different fix', () => {
    const local = `src/App.tsx(2,10): error TS2305: Module '"./Button"' has no exported member 'Button'.`
    expect(extractMissingExportMember(local)).toBeNull()
  })

  it('offers the names the package really exports', () => {
    const directive = buildDiagnosticFixDirective(OUTPUT, () => ['Dialog', 'Menu', 'Listbox', 'Switch'])
    expect(directive).toContain('THAT PACKAGE DOES NOT EXPORT THAT NAME')
    expect(directive).toContain('actually exports: Dialog, Menu, Listbox, Switch')
    expect(directive).toContain('"write_file" on "src/components/TaskCard.tsx"')
    expect(directive).toContain(`Do NOT re-import "Card"`)
  })

  it('says the names are unknown rather than claiming the package exports nothing', () => {
    const directive = buildDiagnosticFixDirective(OUTPUT, () => [])
    expect(directive).toContain('could not be read')
    expect(directive).not.toContain('actually exports:')
    // With no list to choose from, the only honest instruction is to write the thing.
    expect(directive).toContain('building "Card" yourself')
  })

  it('carries one imperative, like every other branch here', () => {
    const directive = buildDiagnosticFixDirective(OUTPUT, () => ['Dialog'])
    expect((directive || '').split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(2)
  })
})

/**
 * The caller needs the path as a path, to read that file off disk and hand its current content to
 * the model. Nine live runs show it never reads one itself: 2026-08-25T20:52 ended with 30
 * write_file calls against 11 distinct files, 19 of them rewrites, and zero reads.
 */
describe('diagnosticFixTargetFile', () => {
  it('names the importer for an export mismatch', () => {
    const out = `src/main.tsx(2,8): error TS2613: Module '"./App"' has no default export. Did you mean to use 'import { App } from "./App"' instead?`
    expect(diagnosticFixTargetFile(out)).toBe('src/main.tsx')
  })

  it('names the file to CREATE for a missing relative module', () => {
    const out = "src/services/index.ts(2,15): error TS2307: Cannot find module './api' or its corresponding type declarations."
    // Does not exist yet, so reading it yields nothing — the correct amount to say about it.
    expect(diagnosticFixTargetFile(out)).toBe('src/services/api.ts')
  })

  it('names the importer when a package lacks the member', () => {
    const out = `src/components/TaskCard.tsx(3,10): error TS2305: Module '"@headlessui/react"' has no exported member 'Card'.`
    expect(diagnosticFixTargetFile(out)).toBe('src/components/TaskCard.tsx')
  })

  it('names nothing when the fix is an install, which changes no file', () => {
    const out = [
      "src/App.tsx(1,19): error TS7016: Could not find a declaration file for module 'react'.",
      "  Try `npm i --save-dev @types/react` if it exists.",
    ].join('\n')
    expect(diagnosticFixTargetFile(out)).toBeNull()
  })

  it('falls back to the first diagnostic outside node_modules', () => {
    const out = 'src/App.tsx(7,3): error TS2322: Type mismatch.'
    expect(diagnosticFixTargetFile(out)).toBe('src/App.tsx')
  })
})
