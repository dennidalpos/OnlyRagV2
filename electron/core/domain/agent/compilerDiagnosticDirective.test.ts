import { describe, it, expect } from 'vitest'
import {
  extractCssSyntaxFailure,
  extractMissingScriptProgram,
  extractBundlerMissingExport,
  extractUnresolvedBundlerImport,
  extractUnresolvedCssImport,
  buildDiagnosticFixAdvice,
  buildDeferredDiagnosticNote,
  extractExportMismatch,
  extractSuggestedCommand,
  parseCompilerDiagnostics,
  extractMissingRelativeModule,
  extractMissingExportMember,
  diagnosticFixTargetFile,
  diagnosticFixRequiredTools,
  extractJsxInScriptFile,
  resolveRelativeImportPath,
} from './compilerDiagnosticDirective'
import { extractFailingTest } from './testFailureDiagnostic'
import { ORDER_MARKER, renderAdvice, renderOrder } from './diagnosticAdvice'

/** The fix as the arbiter orders it, the form in which its wording matters most. */
function buildDiagnosticFixDirective(...args: Parameters<typeof buildDiagnosticFixAdvice>): string | null {
  const advice = buildDiagnosticFixAdvice(...args)
  return advice && renderOrder(advice)
}
import { DiagnosticOutputReducer } from './diagnosticOutputReducer'

/** The exact output `npx tsc --noEmit` produced at step 21 of the live run of 2026-08-24. */
const TSC_OUTPUT = [
  'src/main.tsx(4,8): error TS1192: Module \'"C:/Users/x/src/App"\' has no default export.',
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
    // wording offered it first. See schemaStopReason in agentProgressPolicy.ts.
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

/** The error that ran from step 16 to step 49 of the live run of 2026-08-24, unchanged, while the directive kept ordering a rewrite of the file it names. */
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
    expect(extractSuggestedCommand("  Try `declare module 'react';` instead")).toBeNull()
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

/** The bottleneck blueprint §5.6i names: the model writes a default import against a named export, or a named import against a default one. */
const TS2613_OUTPUT =
  'src/main.tsx(2,8): error TS2613: Module \'"C:/w/src/App"\' has no default export. Did you mean to use \'import { App } from "C:/w/src/App"\' instead?'
const TS2614_OUTPUT =
  "src/routes/index.tsx(3,10): error TS2614: Module '\"../pages/Dashboard\"' has no exported member 'Dashboard'. Did you mean to use 'import Dashboard from \"../pages/Dashboard\"' instead?"

describe('extractExportMismatch', () => {
  it('takes the replacement import the compiler printed, verbatim', () => {
    expect(extractExportMismatch(TS2613_OUTPUT)!.suggestedImport).toBe('import { App } from "C:/w/src/App"')
    expect(extractExportMismatch(TS2614_OUTPUT)!.suggestedImport).toBe('import Dashboard from "../pages/Dashboard"')
    expect(extractExportMismatch(TS2614_OUTPUT)!.moduleSpecifier).toBe('../pages/Dashboard')
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

  it('does not treat the compiler suggestion as proof that the local import is the wrong side', () => {
    const directive = buildDiagnosticFixDirective(TS2614_OUTPUT)!

    expect(directive).toContain('one mechanically valid fix')
    expect(directive).toContain('does not prove which public API the task requires')
    expect(directive).toContain('src/pages/Dashboard.tsx')
    expect(directive).toContain('import Dashboard from "../pages/Dashboard"')
    expect(directive).toContain('"write_file" on exactly one side')
    expect(directive.match(/^\d+\. /gm)).toHaveLength(2)
    expect(directive).toContain('Do NOT re-run the command until you have changed a file')
  })

  it('orders the suggested import when the local module confirms a default export', () => {
    const directive = buildDiagnosticFixDirective(TS2614_OUTPUT, undefined, () => ['default'])!

    expect(directive).toContain('THE LOCAL MODULE EXPORT CONTRACT IS AUTHORITATIVE')
    expect(directive).toContain('MUST be "write_file" on "src/routes/index.tsx"')
    expect(directive).toContain('replacing line 3 with exactly: import Dashboard from "../pages/Dashboard"')
    expect(directive).toContain('Do NOT edit "src/pages/Dashboard.tsx"')
  })

  it('allows the imported local module to define the intended export contract', () => {
    const directive = buildDiagnosticFixDirective(TS2613_OUTPUT)!

    expect(directive).toContain('If the task requires the current import contract')
    expect(directive).not.toContain('Do NOT rename the export')
    expect(directive).not.toContain('do NOT edit the module being imported')
  })

  it('replaces the generic file-and-line directive instead of being appended to it', () => {
    const directive = buildDiagnosticFixDirective(TS2613_OUTPUT)!

    expect(directive).toContain('IMPORT AND EXPORT DISAGREE')
    expect(directive).not.toContain('THE COMPILER NAMED THE FILE AND THE LINE')
  })

  it('prioritizes the mismatch while still listing an unrelated first error', () => {
    const mixed = ["src/routes/index.tsx(8,15): error TS2304: Cannot find name 'TasksPage'.", TS2613_OUTPUT].join('\n')
    const directive = buildDiagnosticFixDirective(mixed)!

    expect(directive).toContain('MUST be "write_file" on exactly one side')
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

    expect(note).toContain('ALSO REPORTED, AFTER THE FIX ABOVE')
    expect(note).toContain('src/components/Button.tsx line 6')
    expect(note).toContain('src/main.tsx line 6')
    // The module error belongs to the directive above, not here.
    expect(note).not.toContain('react-router-dom')
  })

  it('gives no instruction for now, so one message still carries one imperative', () => {
    const note = buildDeferredDiagnosticNote(MIXED)!

    expect(note).toContain('best left for a later step')
    expect(note).not.toMatch(/next tool call MUST/i)
    expect(note).not.toMatch(/\bwrite_file\b/)
  })

  it('says nothing when every error is about resolving a module', () => {
    expect(buildDeferredDiagnosticNote("src/App.tsx(3,56): error TS2792: Cannot find module 'x'.")).toBeNull()
    expect(buildDeferredDiagnosticNote('')).toBeNull()
  })
})

describe('diagnostics inside node_modules', () => {
  // Run 10 of 2026-08-25 pinned typescript@^4.7.3, which then could not parse the @types/node npm had installed.
  const IN_DEPS = [
    'node_modules/@types/node/ffi.d.ts(277,43): error TS1109: Expression expected.',
    "node_modules/@types/node/ffi.d.ts(285,30): error TS1005: ',' expected.",
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

/** Measured 2026-08-25T19:44, session live-full-task, step 21. */
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

/** The measured case, 2026-08-25T19:59 steps 42-43: `@headlessui/react` exports neither `Card` nor `List`. */
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

  it('offers the names exported by a relative local module', () => {
    const local = `src/App.tsx(2,10): error TS2305: Module '"./Button"' has no exported member 'Button'.`
    const directive = buildDiagnosticFixDirective(
      local,
      () => [],
      (importingFile, specifier) => {
        expect(importingFile).toBe('src/App.tsx')
        expect(specifier).toBe('./Button')
        return ['PrimaryButton', 'ButtonProps']
      },
    )

    expect(directive).toContain('[LOCAL MODULE DOES NOT EXPORT THAT NAME]')
    expect(directive).toContain('actually exports: PrimaryButton, ButtonProps')
    expect(directive).toContain('"write_file" on "src/App.tsx"')
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

/** The caller needs the path as a path, to read that file off disk and hand its current content to the model. */
describe('diagnosticFixTargetFile', () => {
  it('names the imported local module for an export mismatch', () => {
    const out = `src/main.tsx(2,8): error TS2613: Module '"./App"' has no default export. Did you mean to use 'import { App } from "./App"' instead?`
    expect(diagnosticFixTargetFile(out)).toBe('src/App.tsx')
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
      '  Try `npm i --save-dev @types/react` if it exists.',
    ].join('\n')
    expect(diagnosticFixTargetFile(out)).toBeNull()
  })

  it('falls back to the first diagnostic outside node_modules', () => {
    const out = 'src/App.tsx(7,3): error TS2322: Type mismatch.'
    expect(diagnosticFixTargetFile(out)).toBe('src/App.tsx')
  })
})

/** Vite 8/rolldown output of the live full task run of 2026-09-23 (step 15). */
const ROLLDOWN_JSX_IN_JS = `> project-dashboard-task@1.0.0 build
> vite build

vite v8.2.2 building client environment for production...
[PARSE_ERROR] Unexpected JSX expression
   ╭─[ src/App.js:8:5 ]
   │
 8 │     <div className="flex h-screen">
   │ Help: JSX syntax is disabled and should be enabled via the parser options
───╯
    at aggregateBindingErrorsIntoJsError (file:///D:/x/node_modules/rolldown/dist/shared/error.mjs:48:18)`

describe('JSX in a .js file', () => {
  it('finds the project file and the .jsx name it needs, skipping node_modules frames', () => {
    expect(extractJsxInScriptFile(ROLLDOWN_JSX_IN_JS)).toEqual({ file: 'src/App.js', line: 8, renamedFile: 'src/App.jsx' })
    expect(extractJsxInScriptFile('src/App.js:3:1: ERROR: The JSX syntax extension is not currently enabled')).toMatchObject({
      file: 'src/App.js',
    })
  })

  it('reads the Vitest import-analysis spelling, and never mistakes the .jsx test file for a .js one', () => {
    // Full-task run 9, 2026-09-24: the smoke test could not load src/App.js, which still held JSX.
    const vitest = [
      ' ❯ src/App.test.jsx (0 test)',
      ' FAIL  src/App.test.jsx [ src/App.test.jsx ]',
      'Error: Failed to parse source for import analysis because the content contains invalid JS syntax. If you are using JSX, make sure to name the file with the .jsx or .tsx extension.',
      '  Plugin: vite:import-analysis',
      '  File: src/App.js:15:16',
      ' ❯ TransformPluginContext._formatLog node_modules/vite/dist/node/chunks/node.js:8393:39',
    ].join('\n')

    expect(extractJsxInScriptFile(vitest)).toEqual({ file: 'src/App.js', line: 15, renamedFile: 'src/App.jsx' })
    expect(buildDiagnosticFixDirective(vitest)).toContain('MUST be "move_file" with sourcePath "src/App.js"')
  })

  it('orders a rename instead of a rewrite, and publishes move_file as the tool it needs', () => {
    const directive = buildDiagnosticFixDirective(ROLLDOWN_JSX_IN_JS)!

    expect(directive).toContain('MUST be "move_file" with sourcePath "src/App.js" and targetPath "src/App.jsx"')
    expect(directive).not.toContain('MUST be "write_file"')
    expect(diagnosticFixRequiredTools(ROLLDOWN_JSX_IN_JS)).toEqual(['move_file'])
    expect(diagnosticFixTargetFile(ROLLDOWN_JSX_IN_JS)).toBeNull()
  })

  it('stays out of every other failure', () => {
    expect(extractJsxInScriptFile(TSC_OUTPUT)).toBeNull()
    expect(diagnosticFixRequiredTools(TSC_OUTPUT)).toEqual([])
  })
})

describe('an unresolvable stylesheet @import', () => {
  /** Full task run 16 of 2026-09-24 (vite 8), colours stripped. */
  const VITE_CSS = [
    '> vite build',
    'transforming...',
    'Unable to resolve `@import "tailwindcss/tailwind.min.css"` from D:/live/ws/src',
    '✗ Build failed in 527ms',
    'error during build:',
    '[plugin vite:css] D:/live/ws/src/index.css',
  ].join('\n')
  const facts = {
    toWorkspaceRelative: (filePath: string) => filePath.replace('D:/live/ws/', ''),
    packageHasStyleEntry: (pkg: string) => pkg === 'tailwindcss',
  }

  it('names the stylesheet, the specifier and the package', () => {
    expect(extractUnresolvedCssImport(VITE_CSS)).toEqual({
      file: 'D:/live/ws/src/index.css',
      specifier: 'tailwindcss/tailwind.min.css',
      packageName: 'tailwindcss',
    })
    expect(extractUnresolvedCssImport('Unable to resolve `@import "./theme.css"` from src\nsrc/styles/main.css')?.packageName).toBeNull()
  })

  it('orders the bare package import when the package ships a stylesheet entry', () => {
    const directive = buildDiagnosticFixDirective(VITE_CSS, undefined, undefined, facts)!

    expect(directive).toContain('[CSS @import DOES NOT RESOLVE — "src/index.css"]')
    expect(directive).toContain('replaced by exactly: @import "tailwindcss";')
    expect(diagnosticFixTargetFile(VITE_CSS, facts)).toBe('src/index.css')
  })

  it('orders the line removed when nothing installed can take its place', () => {
    const directive = buildDiagnosticFixDirective(VITE_CSS, undefined, undefined, { toWorkspaceRelative: facts.toWorkspaceRelative })!

    expect(directive).toContain('@import "tailwindcss/tailwind.min.css"; removed')
  })
})

describe('a relative import the bundler could not resolve', () => {
  /** Full task run 20 of 2026-09-24 (vite 8 / rolldown), colours stripped. */
  const ROLLDOWN = [
    '> vite build',
    '✗ Build failed in 102ms',
    'error during build:',
    "[UNRESOLVED_IMPORT] Could not resolve './tailwind.css' in src/App.jsx",
    '   ╭─[ src/App.jsx:2:8 ]',
    ' 2 │ import "./tailwind.css";',
  ].join('\n')

  it('names the importer and the specifier', () => {
    expect(extractUnresolvedBundlerImport(ROLLDOWN)).toEqual({ importer: 'src/App.jsx', specifier: './tailwind.css' })
    expect(extractUnresolvedBundlerImport('Failed to resolve import "./Button" from "src/App.jsx". Does the file exist?')).toEqual({
      importer: 'src/App.jsx',
      specifier: './Button',
    })
  })

  it('leaves a test file that did not load to the test diagnostic', () => {
    expect(extractUnresolvedBundlerImport('Failed to resolve import "../App" from "src/App.test.jsx". Does the file exist?')).toBeNull()
  })

  it('orders a missing stylesheet import removed from the importer', () => {
    const directive = buildDiagnosticFixDirective(ROLLDOWN, undefined, undefined, { fileExists: () => false })!

    expect(directive).toContain('MUST be "write_file" on "src/App.jsx": the same complete file without the line that imports "./tailwind.css"')
    expect(diagnosticFixTargetFile(ROLLDOWN, { fileExists: () => false })).toBe('src/App.jsx')
  })

  it('redirects the import when the same file exists nearby', () => {
    const facts = { fileExists: (p: string) => p === 'src/styles/tailwind.css' }
    const directive = buildDiagnosticFixDirective(ROLLDOWN, undefined, undefined, facts)!

    expect(directive).toContain('"./tailwind.css" changed to "./styles/tailwind.css", which exists')
  })

  it('orders a missing module created', () => {
    const output = 'Failed to resolve import "./Button" from "src/App.jsx". Does the file exist?'
    const directive = buildDiagnosticFixDirective(output, undefined, undefined, { fileExists: () => false })!

    expect(directive).toContain('MUST be "write_file" on "src/Button.jsx", creating that file')
    expect(diagnosticFixTargetFile(output, { fileExists: () => false })).toBe('src/Button.jsx')
  })

  it('attributes a Vitest module load failure to the imported source file', () => {
    const output = [
      '> vitest run',
      ' ❯ src/App.test.jsx (0 test)',
      ' FAIL  src/App.test.jsx [ src/App.test.jsx ]',
      "Error: Cannot find module './components/Dashboard' imported from C:/live/project/src/App.jsx",
      ' ❯ src/App.jsx:6:1',
      "      6| import Dashboard from './components/Dashboard';",
      ' ❯ src/App.test.jsx:4:1',
    ].join('\n')

    expect(extractUnresolvedBundlerImport(output)).toEqual({ importer: 'src/App.jsx', specifier: './components/Dashboard' })
    expect(buildDiagnosticFixDirective(output, undefined, undefined, { fileExists: () => false })).toContain(
      'MUST be "write_file" on "src/components/Dashboard.jsx"',
    )
    expect(diagnosticFixTargetFile(output, { fileExists: () => false })).toBe('src/components/Dashboard.jsx')
  })

  it('redirects a parent import to an existing component file', () => {
    const output = "[UNRESOLVED_IMPORT] Could not resolve '../Navbar' in src/App.jsx"
    const facts = { fileExists: (path: string) => path === 'src/components/Navbar.jsx' }

    expect(buildDiagnosticFixDirective(output, undefined, undefined, facts)).toContain('"../Navbar" changed to "./components/Navbar"')
    expect(diagnosticFixTargetFile(output, facts)).toBe('src/App.jsx')
  })
})

describe('an npm script whose program is not installed', () => {
  /** Full task run 23 of 2026-09-24, Italian cmd.exe. */
  const CMD_IT = [
    '> project-dashboard-task@1.0.0 build',
    '> react-scripts build',
    '',
    "'react-scripts' non è riconosciuto come comando interno o esterno,",
    ' un programma eseguibile o un file batch.',
  ].join('\n')

  it('reads the script, its body and the missing program in cmd.exe and POSIX spellings', () => {
    expect(extractMissingScriptProgram(CMD_IT)).toEqual({ script: 'build', body: 'react-scripts build', program: 'react-scripts' })
    expect(extractMissingScriptProgram("> app@1.0.0 build\n> tsc -b\n\n'tsc' is not recognized as an internal or external command,")?.program).toBe('tsc')
    expect(extractMissingScriptProgram('> app@1.0.0 test\n> vitest run\n\nsh: 1: vitest: not found')?.program).toBe('vitest')
  })

  it('points the script at the installed Vite', () => {
    const facts = { binaryInstalled: (name: string) => name === 'vite' }
    const directive = buildDiagnosticFixDirective(CMD_IT, undefined, undefined, facts)!

    expect(directive).toContain('the "build" script changed to exactly "vite build"')
    expect(diagnosticFixTargetFile(CMD_IT, facts)).toBe('package.json')
    expect(diagnosticFixRequiredTools(CMD_IT, facts)).toEqual([])
  })

  it('orders the program installed when nothing can stand in for it', () => {
    const output = "> app@1.0.0 build\n> tsc -b\n\n'tsc' is not recognized as an internal or external command,"
    const directive = buildDiagnosticFixDirective(output, undefined, undefined, { binaryInstalled: () => false })!

    expect(directive).toContain('MUST be "run_command" with the command: npm install --save-dev typescript')
    expect(diagnosticFixTargetFile(output, { binaryInstalled: () => false })).toBeNull()
    expect(diagnosticFixRequiredTools(output, { binaryInstalled: () => false })).toEqual(['run_command'])
  })
})

describe('a stylesheet PostCSS cannot parse', () => {
  const POSTCSS = [
    '> vite build',
    '✗ Build failed in 325ms',
    'error during build:',
    '[plugin vite:css] D:/live/ws/src/index.css',
    'CssSyntaxError: [postcss] D:/live/ws/src/index.css:3:1: Unknown word',
    '    at Input.error (node_modules/postcss/lib/input.js:106:16)',
  ].join('\n')
  const facts = { toWorkspaceRelative: (filePath: string) => filePath.replace('D:/live/ws/', '') }

  it('names the stylesheet, the line and the reason', () => {
    expect(extractCssSyntaxFailure(POSTCSS)).toEqual({ file: 'D:/live/ws/src/index.css', line: 3, reason: 'Unknown word' })
    expect(extractCssSyntaxFailure('[plugin vite:css] src/theme.css\nCssSyntaxError: something')?.file).toBe('src/theme.css')
  })

  it('orders the stylesheet rewritten as valid CSS', () => {
    const directive = buildDiagnosticFixDirective(POSTCSS, undefined, undefined, facts)!

    expect(directive).toContain('[STYLESHEET SYNTAX ERROR — "src/index.css" line 3]')
    expect(directive).toContain('MUST be "write_file" on "src/index.css"')
    expect(diagnosticFixTargetFile(POSTCSS, facts)).toBe('src/index.css')
  })
})

describe('bundler missing export (Rollup and Rolldown)', () => {
  // Live full task run 30 of 2026-09-25, Vite 8.3.1: the importer is only in the code frame.
  const ROLLDOWN_MISSING_EXPORT = [
    'vite v8.3.1 building client environment for production...',
    '\u001b[31m[MISSING_EXPORT] \u001b[0m"default" is not exported by "src/App.jsx".',
    '   \u001b[38;5;246m╭\u001b[0m\u001b[38;5;246m─\u001b[0m\u001b[38;5;246m[\u001b[0m src/main.jsx:3:8 \u001b[38;5;246m]\u001b[0m',
    ' 3 │ import App from "./App.jsx"',
  ].join('\n')
  const ROLLUP_MISSING_EXPORT = 'error during build:\nRollupError: "Header" is not exported by "src/components/Header.jsx", imported by "src/App.jsx".'

  it('reads the exporter and the importer from both formats', () => {
    expect(extractBundlerMissingExport(ROLLDOWN_MISSING_EXPORT)).toEqual({ name: 'default', exporter: 'src/App.jsx', importer: 'src/main.jsx' })
    expect(extractBundlerMissingExport(ROLLUP_MISSING_EXPORT)).toEqual({
      name: 'Header',
      exporter: 'src/components/Header.jsx',
      importer: 'src/App.jsx',
    })
    expect(extractBundlerMissingExport('"x" is not exported by "node_modules/pkg/index.js"')).toBeNull()
  })

  it('orders the default export added to the exporter, naming the component it already exports', () => {
    const resolveLocal = (importer: string, specifier: string) => (importer === 'src/App.jsx' && specifier === './App.jsx' ? ['App'] : [])
    const directive = buildDiagnosticFixDirective(ROLLDOWN_MISSING_EXPORT, () => [], resolveLocal)

    expect(directive).toContain('"src/main.jsx" IMPORTS "default" FROM "src/App.jsx"')
    expect(directive).toContain('MUST be "write_file" on "src/App.jsx": the same complete file with "export default App" added as its last line')
    expect(diagnosticFixTargetFile(ROLLDOWN_MISSING_EXPORT)).toBe('src/App.jsx')
  })

  it('orders a missing named export without guessing when the exports are unknown', () => {
    const directive = buildDiagnosticFixDirective(ROLLUP_MISSING_EXPORT)

    expect(directive).toContain('MUST be "write_file" on "src/components/Header.jsx": the same complete file, also exporting "Header"')
  })
})

describe('a browser global read by the code under test', () => {
  // Live full task run 31 of 2026-09-25: BrowserRouter read `document` under renderToString in Node.
  const DOCUMENT_IN_PACKAGE = [
    ' RUN  v5.0.2 C:/work/app',
    ' ❯ src/App.test.jsx (1 test | 1 failed) 6ms',
    '     × should render correctly 5ms',
    ' Test Files  1 failed (1)',
    ' FAIL  src/App.test.jsx > renders the app > should render correctly',
    'ReferenceError: document is not defined',
    ' ❯ getUrlBasedHistory node_modules/react-router/dist/development/chunk-OB3PAWPO.mjs:281:27',
    ' ❯ createBrowserHistory node_modules/react-router/dist/development/chunk-OB3PAWPO.mjs:155:10',
  ].join('\n')
  const installed = (present: boolean) => ({ fileExists: (p: string) => present && p === 'node_modules/jsdom/package.json' })

  it('is not read as a missing import', () => {
    const failing = extractFailingTest(DOCUMENT_IN_PACKAGE)
    expect(failing).toMatchObject({ file: 'src/App.test.jsx', browserGlobal: 'document', browserGlobalPackage: 'react-router' })
    expect(failing?.undefinedName).toBeUndefined()
  })

  it('orders the DOM environment header once jsdom is installed', () => {
    const directive = buildDiagnosticFixDirective(
      DOCUMENT_IN_PACKAGE,
      () => [],
      () => [],
      installed(true),
    )

    expect(directive).toContain('thrown inside the package "react-router"')
    // Split so Vitest does not read the pragma in this very file and look for jsdom.
    const header = `// @vitest-${'environment'} jsdom`
    expect(directive).toContain(`MUST be "write_file" on "src/App.test.jsx": the same complete file with this exact first line: ${header}`)
    expect(directive).not.toContain('WITHOUT IMPORTING')
    expect(diagnosticFixTargetFile(DOCUMENT_IN_PACKAGE, installed(true))).toBe('src/App.test.jsx')
    expect(diagnosticFixRequiredTools(DOCUMENT_IN_PACKAGE, installed(true))).toEqual([])
  })

  it('orders the jsdom install first when it is missing', () => {
    const directive = buildDiagnosticFixDirective(
      DOCUMENT_IN_PACKAGE,
      () => [],
      () => [],
      installed(false),
    )

    expect(directive).toContain('MUST be "run_command" with the command: npm install --save-dev jsdom')
    expect(diagnosticFixTargetFile(DOCUMENT_IN_PACKAGE, installed(false))).toBeNull()
    expect(diagnosticFixRequiredTools(DOCUMENT_IN_PACKAGE, installed(false))).toEqual(['run_command'])
  })
})

describe('a CSS @import that loads a package script', () => {
  // Live full task run 33 of 2026-09-25: @import "tailwindcss" with Tailwind 3 declared.
  const TAILWIND3_IMPORT = [
    '> project-dashboard-task@1.0.0 build',
    '> vite build',
    'vite v8.3.1 building client environment for production...',
    'transforming...',
    '✓ 15 modules transformed.',
    '✗ Build failed in 692ms',
    'error during build:',
    'Build failed with 1 error:',
    '',
    '[plugin vite:css] C:/work/app/src/index.css:1:0',
    'CssSyntaxError: [postcss] postcss-import: C:\\work\\app\\node_modules\\tailwindcss\\lib\\index.js:1:1: Unknown word "use strict"',
    ...Array.from({ length: 30 }, (_, i) => `    at frame${i} (C:\\work\\app\\node_modules\\postcss\\lib\\parser.js:${600 + i}:22)`),
    '  errors: [Getter/Setter]',
    '}',
  ].join('\n')
  const facts = { toWorkspaceRelative: (p: string) => p.replace('C:/work/app/', '') }

  it('orders the Tailwind 3 directives in place of the Tailwind 4 import', () => {
    const directive = buildDiagnosticFixDirective(
      TAILWIND3_IMPORT,
      () => [],
      () => [],
      facts,
    )

    expect(directive).toContain('[A CSS @import LOADS JAVASCRIPT — "src/index.css" IMPORTS THE "tailwindcss" PACKAGE]')
    expect(directive).toContain(
      'MUST be "write_file" on "src/index.css": the same complete file with the line @import "tailwindcss"; replaced by these three lines: @tailwind base;',
    )
    expect(diagnosticFixTargetFile(TAILWIND3_IMPORT, facts)).toBe('src/index.css')
  })

  it('still names the stylesheet after the output is distilled for the trajectory', () => {
    const distilled = DiagnosticOutputReducer.distillTerminalOutput(TAILWIND3_IMPORT, 1500)
    expect(distilled).toContain('[TERMINAL OUTPUT DISTILLED')

    expect(diagnosticFixTargetFile(distilled, facts)).toBe('src/index.css')
    expect(
      buildDiagnosticFixDirective(
        distilled,
        () => [],
        () => [],
        facts,
      ),
    ).toContain('IMPORTS THE "tailwindcss" PACKAGE')
  })
})

describe('Rolldown unresolved import after distillation', () => {
  // Live full task run 35 of 2026-09-25: the build was re-run 19 times with no file named.
  const UNRESOLVED = [
    '> project-dashboard-task@1.0.0 build',
    '> vite build',
    'vite v8.3.1 building client environment for production...',
    'transforming...',
    '✓ 15 modules transformed.',
    '✗ Build failed in 109ms',
    'error during build:',
    'Build failed with 2 errors:',
    "\u001b[31m[UNRESOLVED_IMPORT] \u001b[0mCould not resolve './components/Dashboard' in src/App.jsx",
    '   \u001b[38;5;246m╭\u001b[0m\u001b[38;5;246m─[\u001b[0m src/App.jsx:3:23 \u001b[38;5;246m]\u001b[0m',
    ...Array.from({ length: 40 }, (_, i) => `   │ help line ${i} with nothing a diagnosis needs`),
  ].join('\n')

  it('keeps the unresolved import line, so the arbiter can still name the file', () => {
    const distilled = DiagnosticOutputReducer.distillTerminalOutput(UNRESOLVED, 800)
    expect(distilled).toContain('[TERMINAL OUTPUT DISTILLED')
    expect(distilled).toContain("Could not resolve './components/Dashboard' in src/App.jsx")
    expect(diagnosticFixTargetFile(UNRESOLVED)).toBe('src/components/Dashboard.jsx')
    expect(diagnosticFixTargetFile(distilled)).toBe('src/components/Dashboard.jsx')
  })
})

describe('the fix as a tool result carries it', () => {
  it('is advice: only the arbiter turns a diagnosed fix into an order', () => {
    for (const output of [TSC_OUTPUT, TS7016_OUTPUT, TS2613_OUTPUT, TS2614_OUTPUT, ROLLDOWN_JSX_IN_JS]) {
      const advice = buildDiagnosticFixAdvice(output)!
      expect(renderAdvice(advice)).not.toMatch(ORDER_MARKER)
      expect(renderOrder(advice)).toMatch(ORDER_MARKER)
    }
  })
})
